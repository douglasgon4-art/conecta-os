import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { as, at, makeUser, standardContract, uniq } from "./helpers";
import { convertLead, createLead, getLead, listLeads, logCall, leadListCounts } from "@/server/services/leads";
import { clients, invoices, tasks } from "@/server/db/schema";
import { archiveClient } from "@/server/services/clients";

const TODAY = at("2026-10-22");

describe("Ventas y prospectos", () => {
  it("agrega un prospecto a pendientes de contactar y aparece en la lista dinámica", async () => {
    const sales = await makeUser("ventas");
    const name = uniq("Clínica Ejemplo");
    const lead = await as(sales, (ctx) => createLead(ctx, { tradeName: name, city: "Estelí", phone: "8765 4321" }), TODAY);
    expect(lead.status).toBe("pendiente_contactar");
    expect(lead.ownerId).toBe(sales.employeeId);
    const list = await as(sales, (ctx) => listLeads(ctx, { list: "pendientes" }), TODAY);
    expect(list.map((l) => l.lead.id)).toContain(lead.id);
    await expect(as(sales, (ctx) => createLead(ctx, { tradeName: uniq("Otro"), phone: "+505 8765-4321" }), TODAY)).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("registra llamadas conservando el historial y mueve el prospecto de lista", async () => {
    const sales = await makeUser("ventas");
    const lead = await as(sales, (ctx) => createLead(ctx, { tradeName: uniq("Ferretería") }), TODAY);
    await as(sales, (ctx) => logCall(ctx, lead.id, { result: "no_contesto", nextFollowupAt: "2026-10-23" }), TODAY);
    const r = await as(sales, (ctx) => logCall(ctx, lead.id, { result: "contesto", interestLevel: "alto", statusAfter: "interesado", objections: "Precio", nextFollowupAt: "2026-10-22", nextAction: "Enviar propuesta" }), TODAY);
    expect(r.lead.status).toBe("interesado");
    const detail = await as(sales, (ctx) => getLead(ctx, lead.id), TODAY);
    expect(detail.calls).toHaveLength(2);
    const hoy = await as(sales, (ctx) => listLeads(ctx, { list: "hoy" }), TODAY);
    expect(hoy.map((l) => l.lead.id)).toContain(lead.id);
    const counts = await as(sales, (ctx) => leadListCounts(ctx), TODAY);
    expect(counts.interesados).toBeGreaterThan(0);
  });

  it("convierte una venta ganada en cliente con espacios y cuenta por cobrar no pagada, sin duplicar", async () => {
    const sales = await makeUser("ventas");
    const lead = await as(sales, (ctx) => createLead(ctx, { tradeName: uniq("Óptica Sol"), contactName: "Ana", city: "León" }), TODAY);
    const r = await as(sales, (ctx) => convertLead(ctx, lead.id, { contract: standardContract({ startDate: "2026-11-01", billingDay: 5 }) }), TODAY);
    expect(r.created).toBe(true);
    expect(r.workspace!.boards).toBeGreaterThan(0);
    await expect(as(sales, (ctx) => convertLead(ctx, lead.id, { contract: standardContract() }), TODAY)).rejects.toMatchObject({ code: "CONFLICT" });
    const admin = await makeUser("administracion");
    await as(admin, async ({ tx }) => {
      const [c] = await tx.select().from(clients).where(eq(clients.id, r.clientId));
      expect(c.leadId).toBe(lead.id);
      expect(c.contactName).toBe("Ana");
      const invs = await tx.select().from(invoices).where(eq(invoices.clientId, r.clientId));
      expect(invs).toHaveLength(1);
      expect(invs[0]).toMatchObject({ status: "pendiente", paidAmount: 0, dueDate: "2026-11-05" });
      const onboarding = await tx.select().from(tasks).where(eq(tasks.clientId, r.clientId));
      expect(onboarding.length).toBeGreaterThan(0);
    }, TODAY);
  });

  it("una venta de un cliente que ya existía se vincula al registro existente", async () => {
    const sales = await makeUser("ventas");
    const admin = await makeUser("administracion");
    const lead1 = await as(sales, (ctx) => createLead(ctx, { tradeName: uniq("Pizzería") }), TODAY);
    const first = await as(sales, (ctx) => convertLead(ctx, lead1.id, { contract: standardContract() }), TODAY);
    await as(admin, (ctx) => archiveClient(ctx, first.clientId, "Pausa larga"), TODAY);
    const [c] = await as(admin, ({ tx }) => tx.select().from(clients).where(eq(clients.id, first.clientId)), TODAY);
    const lead2 = await as(sales, (ctx) => createLead(ctx, { tradeName: c.tradeName + " 2" }), TODAY);
    const second = await as(sales, (ctx) => convertLead(ctx, lead2.id, { linkClientId: first.clientId, contract: standardContract({ startDate: "2026-12-01" }) }), TODAY);
    expect(second.created).toBe(false);
    expect(second.clientId).toBe(first.clientId);
    const [after] = await as(admin, ({ tx }) => tx.select().from(clients).where(eq(clients.id, first.clientId)), TODAY);
    expect(after.status).toBe("activo");
  });

  it("Ventas no puede registrar pagos", async () => {
    const sales = await makeUser("ventas");
    const { recordInvoicePayment } = await import("@/server/services/invoices");
    await expect(as(sales, (ctx) => recordInvoicePayment(ctx, "00000000-0000-0000-0000-000000000000", { amount: 1, paidAt: "2026-10-22", method: "efectivo" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

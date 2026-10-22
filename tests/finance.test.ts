import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { as, at, makeUser, standardContract, uniq } from "./helpers";
import { createClient } from "@/server/services/clients";
import { createInvoice, invoiceStatus, listInvoices, recordInvoicePayment, voidInvoice } from "@/server/services/invoices";
import { createExpense, createRecurringExpense, expensesSummary, generateRecurringExpenses, recordExpensePayment, setRecurringStatus, findOpenExpenses } from "@/server/services/expenses";
import { expenses, invoices } from "@/server/db/schema";

const TODAY = at("2026-10-22");

describe("Cuentas por cobrar", () => {
  it("cobro parcial, saldo, estado vencido derivado y sin pagos de más", async () => {
    const acc = await makeUser("contabilidad");
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Cobro") }, contract: standardContract() }), TODAY);
    const [inv] = await as(acc, ({ tx }) => tx.select().from(invoices).where(eq(invoices.clientId, r.client.id)), TODAY);
    const p1 = await as(acc, (ctx) => recordInvoicePayment(ctx, inv.id, { amount: 5000, paidAt: "2026-10-22", method: "transferencia", idempotencyKey: "pay-1-" + inv.id }), TODAY);
    expect(p1.invoice).toMatchObject({ paidAmount: 5000, status: "parcial" });
    const again = await as(acc, (ctx) => recordInvoicePayment(ctx, inv.id, { amount: 5000, paidAt: "2026-10-22", method: "transferencia", idempotencyKey: "pay-1-" + inv.id }), TODAY);
    expect(again.duplicate).toBe(true);
    expect(invoiceStatus(again.invoice, "2026-10-22")).toMatchObject({ status: "vencida", balance: 7000, partial: true }); // vencía el 15
    await expect(as(acc, (ctx) => recordInvoicePayment(ctx, inv.id, { amount: 7000.01, paidAt: "2026-10-22", method: "efectivo" }), TODAY)).rejects.toMatchObject({ code: "VALIDATION" });
    const p2 = await as(acc, (ctx) => recordInvoicePayment(ctx, inv.id, { amount: 7000, paidAt: "2026-10-23", method: "efectivo" }), TODAY);
    expect(p2.invoice.status).toBe("pagada");
    await expect(as(acc, (ctx) => voidInvoice(ctx, inv.id, "error"), TODAY)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("factura manual evita duplicados; anular requiere motivo y permiso", async () => {
    const acc = await makeUser("contabilidad");
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Manual") }, contract: standardContract() }), TODAY);
    const i = await as(acc, (ctx) => createInvoice(ctx, { clientId: r.client.id, concept: "Campaña extra", amount: 150, currency: "USD", issueDate: "2026-10-22", dueDate: "2026-11-05" }), TODAY);
    await expect(as(acc, (ctx) => createInvoice(ctx, { clientId: r.client.id, concept: "Campaña extra", amount: 150, currency: "USD", issueDate: "2026-10-22", dueDate: "2026-11-05" }), TODAY)).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(as(admin, (ctx) => voidInvoice(ctx, i.id, "x"), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const v = await as(acc, (ctx) => voidInvoice(ctx, i.id, "Cliente canceló la campaña"), TODAY);
    expect(v.status).toBe("anulada");
    const list = await as(acc, (ctx) => listInvoices(ctx, { clientId: r.client.id }), TODAY);
    expect(list.find((x) => x.id === i.id)?.status).toBe("anulada");
  });
});

describe("Gastos del mes", () => {
  it("gasto único, pago parcial, saldo y resumen del mes", async () => {
    const acc = await makeUser("contabilidad");
    const e = await as(acc, (ctx) => createExpense(ctx, { name: uniq("Herramientas IA"), category: "ia", amount: 80, currency: "USD", dueDate: "2026-10-30" }), TODAY);
    expect(e.status).toBe("pendiente");
    const p = await as(acc, (ctx) => recordExpensePayment(ctx, e.id, { amount: 30, paidAt: "2026-10-22", method: "tarjeta" }), TODAY);
    expect(p.expense).toMatchObject({ paidAmount: 30, status: "parcial" });
    const full = await as(acc, (ctx) => recordExpensePayment(ctx, e.id, { paidAt: "2026-10-22", method: "tarjeta" }), TODAY);
    expect(full.expense).toMatchObject({ paidAmount: 80, status: "pagado" });
    await expect(as(acc, (ctx) => recordExpensePayment(ctx, e.id, { amount: 1, paidAt: "2026-10-22", method: "tarjeta" }), TODAY)).rejects.toMatchObject({ code: "CONFLICT" });
    const s = await as(acc, (ctx) => expensesSummary(ctx, "2026-10-01"), TODAY);
    expect(s.total.USD).toBeGreaterThanOrEqual(80);
    expect(s.paid.USD).toBeGreaterThanOrEqual(80);
    expect(s.byCategory.some((c) => c.name === "Herramientas de inteligencia artificial")).toBe(true);
  });

  it("gasto recurrente genera los períodos sin duplicar y no los marca como pagados", async () => {
    const acc = await makeUser("contabilidad");
    const name = uniq("Alquiler del local");
    const r = await as(acc, (ctx) => createRecurringExpense(ctx, { name, category: "alquiler_local", amount: 6000, currency: "NIO", dayOfMonth: 5, startDate: "2026-01-05" }), TODAY);
    expect(r.generated).toBe(2); // octubre y noviembre (no meses pasados)
    expect(await as(acc, (ctx) => generateRecurringExpenses(ctx, { recurringId: r.recurring.id }), TODAY)).toBe(0);
    const rows = await as(acc, ({ tx }) => tx.select().from(expenses).where(eq(expenses.recurringId, r.recurring.id)), TODAY);
    expect(rows.every((x) => x.status === "pendiente" && x.paidAmount === 0)).toBe(true);
    const open = await as(acc, (ctx) => findOpenExpenses(ctx, name), TODAY);
    expect(open.length).toBe(2);
    const paused = await as(acc, (ctx) => setRecurringStatus(ctx, r.recurring.id, "pausada"), TODAY);
    expect(paused.voided).toBe(1); // noviembre (futuro) anulado; octubre se conserva
    expect(await as(acc, (ctx) => generateRecurringExpenses(ctx, { recurringId: r.recurring.id }), at("2026-12-10"))).toBe(0);
  });

  it("los gastos de nómina manuales piden confirmación y los duplicados se detectan", async () => {
    const acc = await makeUser("contabilidad");
    await expect(as(acc, (ctx) => createExpense(ctx, { name: "Pago planilla", category: "nomina", amount: 5000 }), TODAY)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const n = uniq("Internet");
    await as(acc, (ctx) => createExpense(ctx, { name: n, category: "internet", amount: 1200 }), TODAY);
    await expect(as(acc, (ctx) => createExpense(ctx, { name: n, category: "internet", amount: 1200 }), TODAY)).rejects.toMatchObject({ code: "DUPLICATE" });
    const cm = await makeUser("community_manager");
    await expect(as(cm, (ctx) => createExpense(ctx, { name: "x", category: "otros", amount: 1 }), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

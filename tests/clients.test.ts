import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { as, at, makeUser, standardContract, uniq } from "./helpers";
import {
  archiveClient,
  createClient,
  getClient,
  offboardClient,
  offboardingPreview,
  reactivateClient,
  listClients,
  clientActivity,
} from "@/server/services/clients";
import { initializeClientWorkspace } from "@/server/services/workspace";
import {
  auditLogs,
  clientStatusHistory,
  contentPlanItems,
  contentSessions,
  invoices,
  monthlyContentPlans,
  productionBoards,
  productionDeliverables,
  tasks,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";

const TODAY = at("2026-10-22");

describe("Registro central de clientes", () => {
  it("crea el cliente y genera automáticamente todos sus espacios según el contrato", async () => {
    const admin = await makeUser("administracion");
    const name = uniq("Consultorio Pepitos");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: name, city: "Estelí" }, contract: standardContract() }), TODAY);
    expect(r.client.status).toBe("en_incorporacion");
    expect(r.workspace.modules).toEqual(expect.arrayContaining(["agenda", "estrategia", "produccion", "diseno", "video", "community", "facturacion"]));
    // Oct (actual) + Nov (anticipación de 1 mes)
    expect(r.workspace.boards).toBe(2);
    expect(r.workspace.deliverables).toBe(28);
    expect(r.workspace.plans).toBe(2);
    expect(r.workspace.invoices).toBe(1);
    expect(r.workspace.sessions).toBe(1);
    expect(r.workspace.onboardingTasks).toBeGreaterThanOrEqual(5);

    await as(admin, async ({ tx }) => {
      const boards = await tx.select().from(productionBoards).where(eq(productionBoards.clientId, r.client.id));
      const oct = boards.find((b) => b.period === "2026-10-01")!;
      const ds = await tx.select().from(productionDeliverables).where(eq(productionDeliverables.boardId, oct.id));
      expect(ds.filter((d) => d.kind === "diseno")).toHaveLength(6);
      expect(ds.filter((d) => d.kind === "reel")).toHaveLength(6);
      expect(ds.filter((d) => d.kind === "perfil")).toHaveLength(1);
      expect(ds.filter((d) => d.kind === "portada")).toHaveLength(1);
      const [plan] = await tx.select().from(monthlyContentPlans).where(and(eq(monthlyContentPlans.clientId, r.client.id), eq(monthlyContentPlans.period, "2026-10-01")));
      const items = await tx.select().from(contentPlanItems).where(eq(contentPlanItems.planId, plan.id));
      expect(items.filter((i) => i.kind === "reel")).toHaveLength(6);
      expect(items.filter((i) => i.kind === "diseno")).toHaveLength(6);
      const [inv] = await tx.select().from(invoices).where(eq(invoices.clientId, r.client.id));
      expect(inv.status).toBe("pendiente");
      expect(inv.paidAmount).toBe(0);
      expect(inv.dueDate).toBe("2026-10-15");
      const [session] = await tx.select().from(contentSessions).where(eq(contentSessions.clientId, r.client.id));
      expect(session.expectedDate).toBe("2026-10-22");
      expect(session.status).toBe("pendiente_coordinar");
    }, TODAY);
  });

  it("la inicialización es idempotente: re-ejecutarla no duplica nada", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Idem") }, contract: standardContract() }), TODAY);
    const again = await as(admin, (ctx) => initializeClientWorkspace(ctx, r.client.id), TODAY);
    expect(again).toMatchObject({ boards: 0, deliverables: 0, plans: 0, invoices: 0, onboardingTasks: 0, sessions: 0, modules: [] });
  });

  it("respeta paquetes personalizados (menos servicios)", async () => {
    const admin = await makeUser("administracion");
    const r = await as(
      admin,
      (ctx) =>
        createClient(ctx, {
          client: { tradeName: uniq("Mini") },
          contract: standardContract({ designsPerMonth: 3, reelsPerMonth: 0, includeCover: false, sessionsEnabled: false, includeStrategy: false, includeCommunity: false }),
        }),
      TODAY,
    );
    expect(r.workspace.modules).not.toContain("agenda");
    expect(r.workspace.modules).not.toContain("video");
    expect(r.workspace.plans).toBe(0);
    expect(r.workspace.sessions).toBe(0);
    expect(r.workspace.deliverables).toBe(8); // (3 diseños + perfil) × 2 meses
  });

  it("detecta clientes duplicados", async () => {
    const admin = await makeUser("administracion");
    const name = uniq("Clínica Dup");
    await as(admin, (ctx) => createClient(ctx, { client: { tradeName: name, phone: "+505 8888 1234" }, contract: standardContract() }), TODAY);
    await expect(
      as(admin, (ctx) => createClient(ctx, { client: { tradeName: name.toUpperCase() }, contract: standardContract() }), TODAY),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(
      as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Otro"), phone: "88881234" }, contract: standardContract() }), TODAY),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("un diseñador no puede crear clientes ni leer facturas (servicio y RLS)", async () => {
    const designer = await makeUser("disenador");
    await expect(as(designer, (ctx) => createClient(ctx, { client: { tradeName: uniq("X") }, contract: standardContract() }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rows = await as(designer, ({ tx }) => tx.select().from(invoices));
    expect(rows).toHaveLength(0); // la política RLS oculta las filas aunque se consulte directamente
  });

  it("archivar conserva el historial y saca al cliente de los listados operativos", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Archivable") }, contract: standardContract() }), TODAY);
    const res = await as(admin, (ctx) => archiveClient(ctx, r.client.id, "Fin de temporada"), TODAY);
    expect(res.client.status).toBe("archivado");
    expect(res.stats.boardsCancelled).toBe(1); // noviembre
    const list = await as(admin, (ctx) => listClients(ctx, { scope: "operativos" }), TODAY);
    expect(list.find((c) => c.id === r.client.id)).toBeUndefined();
    await as(admin, async ({ tx }) => {
      const boards = await tx.select().from(productionBoards).where(eq(productionBoards.clientId, r.client.id));
      expect(boards).toHaveLength(2); // nada se borra
      const [inv] = await tx.select().from(invoices).where(eq(invoices.clientId, r.client.id));
      expect(inv.status).toBe("pendiente"); // la deuda se conserva
      const hist = await tx.select().from(clientStatusHistory).where(eq(clientStatusHistory.clientId, r.client.id));
      expect(hist.map((h) => h.toStatus)).toEqual(expect.arrayContaining(["en_incorporacion", "archivado"]));
      const openTasks = await tx.select().from(tasks).where(and(eq(tasks.clientId, r.client.id), sql`${tasks.status} in ('pendiente','en_progreso')`));
      expect(openTasks).toHaveLength(0);
    }, TODAY);
  });

  it("dar de baja muestra pendientes, conserva finanzas y reactivar no duplica", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Baja") }, contract: standardContract() }), TODAY);
    const preview = await as(admin, (ctx) => offboardingPreview(ctx, r.client.id, "2026-10-01"), TODAY);
    expect(preview.pendingInvoices).toHaveLength(1);
    expect(preview.balance.NIO).toBe(12000);
    const off = await as(
      admin,
      (ctx) => offboardClient(ctx, r.client.id, { effectiveDate: "2026-10-22", reason: "Cierre del negocio", lastServicePeriod: "2026-10-01" }),
      TODAY,
    );
    expect(off.client.status).toBe("dado_de_baja");
    const detail = await as(admin, (ctx) => getClient(ctx, r.client.id), TODAY);
    expect(detail.offboarding).toHaveLength(1);

    const re = await as(admin, (ctx) => reactivateClient(ctx, r.client.id, standardContract({ startDate: "2026-11-01" }), "Volvió"), TODAY);
    expect(re.client.status).toBe("activo");
    await as(admin, async ({ tx }) => {
      const boards = await tx.select().from(productionBoards).where(eq(productionBoards.clientId, r.client.id));
      expect(boards).toHaveLength(2); // oct + nov reabierto, sin duplicados
      expect(boards.every((b) => b.cancelledAt === null)).toBe(true);
      const plans = await tx.select().from(monthlyContentPlans).where(eq(monthlyContentPlans.clientId, r.client.id));
      expect(plans).toHaveLength(2);
      const invs = await tx.select().from(invoices).where(eq(invoices.clientId, r.client.id));
      expect(invs).toHaveLength(2); // octubre (anterior) + noviembre (nuevo contrato)
      // Sin audit.read, la auditoría directa está oculta por RLS…
      const direct = await tx.execute(sql`select count(*)::int as n from audit_logs where client_id = ${r.client.id}`);
      expect((direct.rows[0] as { n: number }).n).toBe(0);
    }, TODAY);
    // …pero el historial del cliente es visible por la vía autorizada.
    const activity = await as(admin, (ctx) => clientActivity(ctx, r.client.id), TODAY);
    expect(activity.map((a) => a.action)).toEqual(expect.arrayContaining(["client.create", "client.offboard", "client.reactivate"]));
  });
});

describe("Errores", () => {
  it("AppError es reconocible", () => {
    expect(new AppError("VALIDATION", "x")).toBeInstanceOf(Error);
    expect(auditLogs).toBeDefined();
  });
});

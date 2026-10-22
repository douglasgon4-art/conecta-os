import { describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { as, asSystem, at, makeUser, standardContract, uniq } from "./helpers";
import { createClient } from "@/server/services/clients";
import { JOBS, runAutomations } from "@/server/automations";
import { automationRuns, invoices, monthlyContentPlans, notifications, productionBoards } from "@/server/db/schema";

describe("Automatizaciones", () => {
  it("generan el nuevo período sin duplicar, se registran y no se repiten el mismo día", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Auto") }, contract: standardContract({ startDate: "2026-10-01", billingDay: 5 }) }), at("2026-10-02"));
    // Llega noviembre: el cron crea diciembre (anticipación) y emite la factura de noviembre.
    const res = await runAutomations({ now: at("2026-11-01"), jobs: ["monthly_cycles"], triggeredBy: "test" });
    expect(res[0].status).toBe("succeeded");
    const again = await runAutomations({ now: at("2026-11-01"), jobs: ["monthly_cycles"], triggeredBy: "test" });
    expect(again[0].status).toBe("skipped");
    const forced = await runAutomations({ now: at("2026-11-01"), jobs: ["monthly_cycles"], triggeredBy: "test", force: true });
    expect(forced[0].status).toBe("succeeded");
    await asSystem(async ({ tx }) => {
      const boards = await tx.select().from(productionBoards).where(eq(productionBoards.clientId, r.client.id));
      expect(boards.map((b) => b.period).sort()).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
      const plans = await tx.select().from(monthlyContentPlans).where(eq(monthlyContentPlans.clientId, r.client.id));
      expect(plans).toHaveLength(3);
      const invs = await tx.select().from(invoices).where(eq(invoices.clientId, r.client.id));
      expect(invs.map((i) => i.period).sort()).toEqual(["2026-10-01", "2026-11-01"]); // diciembre aún no se emite
      const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.runKey, "monthly_cycles:2026-11-01"));
      expect(run).toMatchObject({ status: "succeeded", attempts: 2 });
    });
  });

  it("los clientes archivados no reciben nuevos ciclos", async () => {
    const admin = await makeUser("administracion");
    const { archiveClient } = await import("@/server/services/clients");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Arch") }, contract: standardContract({ startDate: "2026-10-01" }) }), at("2026-10-02"));
    await as(admin, (ctx) => archiveClient(ctx, r.client.id, "Pausa"), at("2026-10-03"));
    await runAutomations({ now: at("2026-12-01"), jobs: ["monthly_cycles"], triggeredBy: "test" });
    const boards = await asSystem(({ tx }) => tx.select().from(productionBoards).where(eq(productionBoards.clientId, r.client.id)));
    expect(boards.map((b) => b.period).sort()).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("alertas sin duplicados y registro de errores con reintento seguro", async () => {
    const manager = await makeUser("gerencia");
    const r = await as(manager, (ctx) => createClient(ctx, { client: { tradeName: uniq("Alerta") }, contract: standardContract({ startDate: "2026-10-01", firstSessionDate: "2026-11-10" }) }), at("2026-10-02"));
    await runAutomations({ now: at("2026-10-25"), jobs: ["session_alerts"], triggeredBy: "test" });
    await runAutomations({ now: at("2026-10-25"), jobs: ["session_alerts"], triggeredBy: "test", force: true });
    const n1 = await asSystem(({ tx }) => tx.select().from(notifications).where(and(eq(notifications.userId, manager.userId!), sql`${notifications.title} like ${r.client.tradeName + "%"}`)));
    expect(n1).toHaveLength(1);

    const job = JOBS.find((j) => j.key === "recurring_expenses")!;
    const spy = vi.spyOn(job, "run").mockRejectedValueOnce(new Error("Fallo simulado"));
    const failed = await runAutomations({ now: at("2026-10-26"), jobs: ["recurring_expenses"], triggeredBy: "test" });
    expect(failed[0]).toMatchObject({ status: "failed", error: "Fallo simulado" });
    const retry = await runAutomations({ now: at("2026-10-26"), jobs: ["recurring_expenses"], triggeredBy: "test" });
    expect(retry[0]).toMatchObject({ status: "succeeded", attempts: 2 });
    spy.mockRestore();
    const [run] = await asSystem(({ tx }) => tx.select().from(automationRuns).where(eq(automationRuns.runKey, "recurring_expenses:2026-10-26")));
    expect(run.status).toBe("succeeded");
  });

  it("todos los trabajos se ejecutan sin errores", async () => {
    const res = await runAutomations({ now: at("2026-10-31"), triggeredBy: "test", force: true });
    expect(res.filter((r) => r.status === "failed")).toEqual([]);
  });
});

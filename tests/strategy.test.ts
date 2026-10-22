import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { as, at, makeUser, standardContract, uniq } from "./helpers";
import { createClient } from "@/server/services/clients";
import { createMonthlyPlan, duplicatePlanFrom, getPlan, listPlans, setPlanStatus, updatePlan, updatePlanItem } from "@/server/services/strategy";
import { productionBoards, productionDeliverables } from "@/server/db/schema";

const TODAY = at("2026-10-22");

describe("Estrategia y campañas", () => {
  it("planifica 6 reels y 6 diseños, aprueba y genera tareas de producción sin duplicar", async () => {
    const admin = await makeUser("administracion");
    const strategist = await makeUser("estrategia");
    const manager = await makeUser("gerencia");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Plan") }, contract: standardContract() }), TODAY);
    const [row] = await as(strategist, (ctx) => listPlans(ctx, { clientId: r.client.id, period: "2026-11-01" }), TODAY);
    const plan = await as(strategist, (ctx) => getPlan(ctx, row.plan.id), TODAY);
    expect(plan.items.filter((i) => i.kind === "reel")).toHaveLength(6);
    expect(plan.items.filter((i) => i.kind === "diseno")).toHaveLength(6);

    await as(strategist, (ctx) => updatePlan(ctx, plan.id, { strategistId: strategist.employeeId, objectives: "Aumentar citas", pillars: "Educación, testimonios" }), TODAY);
    // No se puede aprobar sin temas
    await expect(as(manager, (ctx) => setPlanStatus(ctx, plan.id, "aprobada"), TODAY)).rejects.toMatchObject({ code: "VALIDATION" });
    for (const item of plan.items) {
      await as(strategist, (ctx) => updatePlanItem(ctx, item.id, { theme: `Tema ${item.kind} ${item.position}`, hook: "¿Sabías que…?", script: "Guion", tentativePublishDate: "2026-11-10" }), TODAY);
    }
    // Estrategia no tiene permiso de aprobar
    await expect(as(strategist, (ctx) => setPlanStatus(ctx, plan.id, "aprobada"), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const approved = await as(manager, (ctx) => setPlanStatus(ctx, plan.id, "aprobada"), TODAY);
    expect(approved.sync!.linked).toBe(12);
    // Aprobar/sincronizar de nuevo no duplica entregables
    await as(strategist, (ctx) => updatePlanItem(ctx, plan.items.find((i) => i.kind === "reel" && i.position === 1)!.id, { theme: "Tema cambiado" }), TODAY);
    const ds = await as(admin, async ({ tx }) => {
      const [b] = await tx.select().from(productionBoards).where(and(eq(productionBoards.clientId, r.client.id), eq(productionBoards.period, "2026-11-01")));
      return tx.select().from(productionDeliverables).where(eq(productionDeliverables.boardId, b.id));
    });
    expect(ds).toHaveLength(14);
    expect(ds.find((d) => d.kind === "reel" && d.position === 1)!.title).toBe("Reel 1: Tema cambiado");
    expect(ds.filter((d) => d.planItemId).length).toBe(12);
  });

  it("crear el siguiente período no copia el contenido anterior; duplicar requiere confirmación", async () => {
    const admin = await makeUser("administracion");
    const strategist = await makeUser("estrategia");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Siguiente") }, contract: standardContract() }), TODAY);
    const [nov] = await as(strategist, (ctx) => listPlans(ctx, { clientId: r.client.id, period: "2026-11-01" }), TODAY);
    await as(strategist, (ctx) => updatePlan(ctx, nov.plan.id, { objectives: "Objetivo noviembre" }), TODAY);
    const dec = await as(strategist, (ctx) => createMonthlyPlan(ctx, r.client.id, "2026-12-15"), TODAY);
    expect(dec.created).toBe(true);
    expect(dec.plan.objectives).toBeNull();
    const again = await as(strategist, (ctx) => createMonthlyPlan(ctx, r.client.id, "2026-12-01"), TODAY);
    expect(again.created).toBe(false);
    await expect(as(strategist, (ctx) => duplicatePlanFrom(ctx, dec.plan.id, nov.plan.id), TODAY)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const dup = await as(strategist, (ctx) => duplicatePlanFrom(ctx, dec.plan.id, nov.plan.id, { confirm: true }), TODAY);
    expect(dup.objectives).toBe("Objetivo noviembre");
    expect(dup.duplicatedFromId).toBe(nov.plan.id);
  });
});

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, contentPlanItems, employees, monthlyContentPlans, productionBoards, productionDeliverables } from "../db/schema";
import { audit, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, notFound } from "../errors";
import { Loose, parse, zDate, zText } from "../validation";
import { addDays, addMonths, firstOfMonth, formatPeriod, maxDate } from "@/lib/dates";
import { COMPLETED_DELIVERABLE_STATUSES, OPERATIVE_CLIENT_STATUSES, PLAN_STATUSES, labelOf, values, type PlanStatus } from "@/lib/domain";
import type { Client, Contract } from "./workspace";
import type { Settings } from "./settings";
import { notify } from "./notifications";

type Plan = typeof monthlyContentPlans.$inferSelect;

/** Crea la planificación del período (y sus reels/diseños vacíos) si no existe. No copia contenido anterior. */
export async function ensurePlan(ctx: Ctx, client: Client, contract: Contract, period: string, settings: Settings) {
  const [prev] = await ctx.tx
    .select({ strategistId: monthlyContentPlans.strategistId })
    .from(monthlyContentPlans)
    .where(and(eq(monthlyContentPlans.clientId, client.id), eq(monthlyContentPlans.period, addMonths(period, -1))));
  const due = maxDate(addDays(period, -settings.strategy_due_days_before), ctx.today)!;
  const inserted = await ctx.tx
    .insert(monthlyContentPlans)
    .values({
      clientId: client.id,
      contractId: contract.id,
      period,
      strategistId: prev?.strategistId ?? null,
      dueDate: due,
      createdBy: ctx.actor.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) {
    const plan = inserted[0];
    const items = [
      ...Array.from({ length: contract.reelsPerMonth }, (_, i) => ({ planId: plan.id, kind: "reel", position: i + 1 })),
      ...Array.from({ length: contract.designsPerMonth }, (_, i) => ({ planId: plan.id, kind: "diseno", position: i + 1 })),
    ];
    if (items.length) await ctx.tx.insert(contentPlanItems).values(items).onConflictDoNothing();
    return { plan, created: true };
  }
  const [plan] = await ctx.tx
    .select()
    .from(monthlyContentPlans)
    .where(and(eq(monthlyContentPlans.clientId, client.id), eq(monthlyContentPlans.period, period)));
  return { plan, created: false };
}

/** Crea manualmente la planificación de un cliente para un mes (sin duplicar si ya existe). */
export async function createMonthlyPlan(ctx: Ctx, clientId: string, periodInput: string) {
  requirePerm(ctx, "strategy.write");
  const period = firstOfMonth(periodInput);
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw notFound("Cliente");
  if (!OPERATIVE_CLIENT_STATUSES.includes(client.status as never)) throw conflict(`${client.tradeName} no está en un estado operativo`);
  const { getActiveContract } = await import("./workspace");
  const { getSettings } = await import("./settings");
  const contract = await getActiveContract(ctx, clientId);
  if (!contract) throw conflict(`${client.tradeName} no tiene contrato vigente`);
  if (!contract.includeStrategy) throw conflict(`El contrato de ${client.tradeName} no incluye planificación estratégica`);
  const r = await ensurePlan(ctx, client, contract, period, await getSettings(ctx));
  if (r.created) {
    await audit(ctx, { action: "plan.create", entityType: "content_plan", entityId: r.plan.id, clientId, summary: `Planificación creada: ${client.tradeName} · ${formatPeriod(period)}` });
  }
  return r;
}

export async function listPlans(ctx: Ctx, f: { period?: string; status?: string; clientId?: string; strategistId?: string } = {}) {
  requirePerm(ctx, "strategy.read");
  const conds = [isNull(monthlyContentPlans.cancelledAt)];
  if (f.period) conds.push(eq(monthlyContentPlans.period, firstOfMonth(f.period)));
  if (f.status) conds.push(eq(monthlyContentPlans.status, f.status));
  if (f.clientId) conds.push(eq(monthlyContentPlans.clientId, f.clientId));
  if (f.strategistId) conds.push(eq(monthlyContentPlans.strategistId, f.strategistId));
  const filled = sql<number>`(select count(*)::int from content_plan_items i where i.plan_id = ${monthlyContentPlans.id} and coalesce(i.theme,'') <> '')`;
  const total = sql<number>`(select count(*)::int from content_plan_items i where i.plan_id = ${monthlyContentPlans.id})`;
  return ctx.tx
    .select({ plan: monthlyContentPlans, clientName: clients.tradeName, strategist: employees.fullName, filled, total })
    .from(monthlyContentPlans)
    .innerJoin(clients, eq(clients.id, monthlyContentPlans.clientId))
    .leftJoin(employees, eq(employees.id, monthlyContentPlans.strategistId))
    .where(and(...conds))
    .orderBy(desc(monthlyContentPlans.period), asc(clients.tradeName));
}

export async function getPlan(ctx: Ctx, id: string) {
  requirePerm(ctx, "strategy.read");
  const [row] = await ctx.tx
    .select({ plan: monthlyContentPlans, clientName: clients.tradeName, strategist: employees.fullName })
    .from(monthlyContentPlans)
    .innerJoin(clients, eq(clients.id, monthlyContentPlans.clientId))
    .leftJoin(employees, eq(employees.id, monthlyContentPlans.strategistId))
    .where(eq(monthlyContentPlans.id, id));
  if (!row) throw notFound("Planificación");
  const items = await ctx.tx
    .select({ item: contentPlanItems, responsible: employees.fullName, deliverableStatus: productionDeliverables.status })
    .from(contentPlanItems)
    .leftJoin(employees, eq(employees.id, contentPlanItems.responsibleId))
    .leftJoin(productionDeliverables, eq(productionDeliverables.id, contentPlanItems.productionDeliverableId))
    .where(eq(contentPlanItems.planId, id))
    .orderBy(asc(contentPlanItems.kind), asc(contentPlanItems.position));
  const previous = await ctx.tx
    .select({ id: monthlyContentPlans.id, period: monthlyContentPlans.period, status: monthlyContentPlans.status })
    .from(monthlyContentPlans)
    .where(and(eq(monthlyContentPlans.clientId, row.plan.clientId), sql`${monthlyContentPlans.period} < ${row.plan.period}`))
    .orderBy(desc(monthlyContentPlans.period))
    .limit(6);
  return {
    ...row.plan,
    clientName: row.clientName,
    strategist: row.strategist,
    items: items.map((i) => ({ ...i.item, responsible: i.responsible, deliverableStatus: i.deliverableStatus })),
    previous,
  };
}

export const planUpdateInput = z.object({
  strategistId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
  dueDate: zDate(),
  objectives: zText(4000),
  targetAudience: zText(4000),
  pillars: zText(4000),
  campaigns: zText(4000),
  themes: zText(4000),
  creativeConcepts: zText(4000),
  visualReferences: zText(4000),
  ctas: zText(2000),
  notes: zText(4000),
});

async function loadPlan(ctx: Ctx, id: string) {
  const [p] = await ctx.tx.select().from(monthlyContentPlans).where(eq(monthlyContentPlans.id, id));
  if (!p) throw notFound("Planificación");
  if (p.cancelledAt) throw conflict("Esta planificación está cancelada");
  return p;
}

export async function updatePlan(ctx: Ctx, id: string, raw: Loose<typeof planUpdateInput>) {
  requirePerm(ctx, "strategy.write");
  const input = parse(planUpdateInput, raw);
  const before = await loadPlan(ctx, id);
  const patch: Partial<typeof monthlyContentPlans.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined || (k in raw && raw[k as keyof typeof raw] === "")) (patch as Record<string, unknown>)[k] = v ?? null;
  if (before.status === "pendiente_planificacion" && Object.keys(patch).some((k) => k !== "strategistId" && k !== "dueDate")) patch.status = "en_planificacion";
  const [after] = await ctx.tx.update(monthlyContentPlans).set(patch).where(eq(monthlyContentPlans.id, id)).returning();
  await audit(ctx, { action: "plan.update", entityType: "content_plan", entityId: id, clientId: before.clientId, summary: `Planificación ${formatPeriod(before.period)} actualizada`, before, after });
  if (before.status === "aprobada" || before.status === "en_produccion") await syncPlanToProduction(ctx, after);
  return after;
}

export const planItemInput = z.object({
  theme: zText(300),
  objective: zText(1000),
  hook: zText(1000),
  script: zText(8000),
  centralIdea: zText(2000),
  references: zText(2000),
  cta: zText(500),
  tentativePublishDate: zDate(),
  responsibleId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
  status: zText(40),
});

export async function updatePlanItem(ctx: Ctx, itemId: string, raw: Loose<typeof planItemInput>) {
  requirePerm(ctx, "strategy.write");
  const input = parse(planItemInput, raw);
  const [item] = await ctx.tx.select().from(contentPlanItems).where(eq(contentPlanItems.id, itemId));
  if (!item) throw notFound("Elemento de la planificación");
  const plan = await loadPlan(ctx, item.planId);
  const patch: Partial<typeof contentPlanItems.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (k in raw) (patch as Record<string, unknown>)[k] = v ?? null;
  const [after] = await ctx.tx.update(contentPlanItems).set(patch).where(eq(contentPlanItems.id, itemId)).returning();
  if (plan.status === "pendiente_planificacion") await ctx.tx.update(monthlyContentPlans).set({ status: "en_planificacion" }).where(eq(monthlyContentPlans.id, plan.id));
  await audit(ctx, {
    action: "plan_item.update",
    entityType: "content_plan_item",
    entityId: itemId,
    clientId: plan.clientId,
    summary: `${item.kind === "reel" ? "Reel" : "Diseño"} ${item.position} de ${formatPeriod(plan.period)} actualizado`,
    before: item,
    after,
  });
  if (["aprobada", "en_produccion"].includes(plan.status)) await syncPlanToProduction(ctx, plan);
  return after;
}

const TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  pendiente_planificacion: ["en_planificacion"],
  en_planificacion: ["revision_interna", "pendiente_aprobacion_cliente", "aprobada"],
  revision_interna: ["en_planificacion", "pendiente_aprobacion_cliente", "cambios_solicitados", "aprobada"],
  pendiente_aprobacion_cliente: ["cambios_solicitados", "aprobada"],
  cambios_solicitados: ["en_planificacion", "revision_interna", "pendiente_aprobacion_cliente"],
  aprobada: ["cambios_solicitados"],
  en_produccion: ["cambios_solicitados"],
  completada: [],
};

export async function setPlanStatus(ctx: Ctx, id: string, to: PlanStatus, note?: string) {
  if (!values(PLAN_STATUSES).includes(to)) throw new AppError("VALIDATION", "Estado de planificación inválido");
  requirePerm(ctx, to === "aprobada" ? "strategy.approve" : "strategy.write");
  const before = await loadPlan(ctx, id);
  if (before.status === to) return before;
  if (!TRANSITIONS[before.status as PlanStatus].includes(to)) {
    throw conflict(`No se puede pasar de "${labelOf(PLAN_STATUSES, before.status)}" a "${labelOf(PLAN_STATUSES, to)}"`);
  }
  if (to === "aprobada") {
    const items = await ctx.tx.select().from(contentPlanItems).where(eq(contentPlanItems.planId, id));
    const missing = items.filter((i) => !i.theme?.trim());
    if (missing.length) {
      throw new AppError("VALIDATION", `Antes de aprobar, define el tema de: ${missing.map((i) => `${i.kind === "reel" ? "Reel" : "Diseño"} ${i.position}`).join(", ")}`);
    }
  }
  const [after] = await ctx.tx
    .update(monthlyContentPlans)
    .set({ status: to, ...(to === "aprobada" ? { approvedAt: new Date(), approvedBy: ctx.actor.userId } : {}) })
    .where(eq(monthlyContentPlans.id, id))
    .returning();
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, before.clientId));
  await audit(ctx, {
    action: "plan.status",
    entityType: "content_plan",
    entityId: id,
    clientId: before.clientId,
    summary: `Planificación ${client.tradeName} · ${formatPeriod(before.period)}: ${labelOf(PLAN_STATUSES, before.status)} → ${labelOf(PLAN_STATUSES, to)}${note ? ` (${note})` : ""}`,
    before,
    after,
  });
  let sync = null;
  if (to === "aprobada") {
    sync = await syncPlanToProduction(ctx, after);
    await notify(ctx, {
      type: "plan_pending",
      severity: "success",
      title: `Planificación aprobada: ${client.tradeName} · ${formatPeriod(before.period)}`,
      body: `${sync.linked} elementos enviados a producción.`,
      link: `/estrategia/${id}`,
      dedupeKey: `plan_approved:${id}:${after.approvedAt?.toISOString()}`,
      broadcast: false,
      userIds: [],
      employeeIds: sync.assignees,
    });
  }
  return { ...after, sync };
}

/**
 * Convierte los elementos aprobados en tareas de producción, sin reescribir información:
 * vincula cada reel/diseño con su entregable del tablero del mismo período. Idempotente.
 */
export async function syncPlanToProduction(ctx: Ctx, plan: Plan) {
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, plan.clientId));
  const { getActiveContract } = await import("./workspace");
  const { getSettings } = await import("./settings");
  const { ensureBoard } = await import("./production");
  const contract = await getActiveContract(ctx, plan.clientId);
  let boardId: string | null = null;
  if (contract) boardId = (await ensureBoard(ctx, client, contract, plan.period, await getSettings(ctx)))?.board.id ?? null;
  if (!boardId) {
    const [b] = await ctx.tx.select({ id: productionBoards.id }).from(productionBoards).where(and(eq(productionBoards.clientId, plan.clientId), eq(productionBoards.period, plan.period)));
    boardId = b?.id ?? null;
  }
  if (!boardId) return { linked: 0, assignees: [] as string[] };
  const items = await ctx.tx.select().from(contentPlanItems).where(eq(contentPlanItems.planId, plan.id));
  const deliverables = await ctx.tx
    .select()
    .from(productionDeliverables)
    .where(and(eq(productionDeliverables.boardId, boardId), inArray(productionDeliverables.kind, ["reel", "diseno"]), eq(productionDeliverables.platform, "")));
  let linked = 0;
  const assignees = new Set<string>();
  for (const item of items) {
    const d = deliverables.find((x) => x.kind === item.kind && x.position === item.position);
    if (!d) continue;
    const label = item.kind === "reel" ? `Reel ${item.position}` : `Arte gráfico ${item.position}`;
    const title = item.theme ? `${label}: ${item.theme}` : label;
    const script = [item.hook && `Gancho: ${item.hook}`, item.script && `Guion: ${item.script}`, item.centralIdea && `Idea: ${item.centralIdea}`, item.references && `Referencias: ${item.references}`, item.cta && `CTA: ${item.cta}`]
      .filter(Boolean)
      .join("\n");
    const done = (COMPLETED_DELIVERABLE_STATUSES as readonly string[]).includes(d.status);
    const patch: Partial<typeof productionDeliverables.$inferInsert> = { planItemId: item.id };
    if (!done) {
      patch.title = title;
      patch.scriptRef = script || d.scriptRef;
      if (item.responsibleId && !d.assigneeId) patch.assigneeId = item.responsibleId;
    }
    await ctx.tx.update(productionDeliverables).set(patch).where(eq(productionDeliverables.id, d.id));
    if (item.productionDeliverableId !== d.id || item.status !== "en_produccion") {
      await ctx.tx.update(contentPlanItems).set({ productionDeliverableId: d.id, status: "en_produccion" }).where(eq(contentPlanItems.id, item.id));
    }
    const assignee = patch.assigneeId ?? d.assigneeId;
    if (assignee) assignees.add(assignee);
    linked++;
  }
  return { linked, assignees: [...assignees], boardId };
}

/** Usa una planificación anterior como punto de partida. Requiere confirmación y solo en planificaciones sin aprobar. */
export async function duplicatePlanFrom(ctx: Ctx, targetId: string, sourceId: string, opts: { confirm?: boolean } = {}) {
  requirePerm(ctx, "strategy.write");
  const target = await loadPlan(ctx, targetId);
  const [source] = await ctx.tx.select().from(monthlyContentPlans).where(eq(monthlyContentPlans.id, sourceId));
  if (!source) throw notFound("Planificación de origen");
  if (source.clientId !== target.clientId) throw conflict("Solo se puede duplicar una planificación del mismo cliente");
  if (!["pendiente_planificacion", "en_planificacion", "cambios_solicitados"].includes(target.status)) {
    throw conflict("Solo se puede duplicar sobre una planificación que aún no está en revisión ni aprobada");
  }
  if (!opts.confirm) {
    throw new AppError("CONFIRMATION_REQUIRED", `Se copiará el contenido de ${formatPeriod(source.period)} en ${formatPeriod(target.period)} y se sobrescribirán los campos actuales. ¿Confirmas?`);
  }
  const fields = ["objectives", "targetAudience", "pillars", "campaigns", "themes", "creativeConcepts", "visualReferences", "ctas"] as const;
  await ctx.tx
    .update(monthlyContentPlans)
    .set({ ...Object.fromEntries(fields.map((f) => [f, source[f]])), duplicatedFromId: source.id, status: "en_planificacion" })
    .where(eq(monthlyContentPlans.id, targetId));
  const srcItems = await ctx.tx.select().from(contentPlanItems).where(eq(contentPlanItems.planId, sourceId));
  const tgtItems = await ctx.tx.select().from(contentPlanItems).where(eq(contentPlanItems.planId, targetId));
  for (const t of tgtItems) {
    const s = srcItems.find((x) => x.kind === t.kind && x.position === t.position);
    if (!s) continue;
    await ctx.tx
      .update(contentPlanItems)
      .set({ theme: s.theme, objective: s.objective, hook: s.hook, script: s.script, centralIdea: s.centralIdea, references: s.references, cta: s.cta, responsibleId: s.responsibleId, tentativePublishDate: null })
      .where(eq(contentPlanItems.id, t.id));
  }
  await audit(ctx, { action: "plan.duplicate", entityType: "content_plan", entityId: targetId, clientId: target.clientId, summary: `Planificación ${formatPeriod(target.period)} duplicada desde ${formatPeriod(source.period)}` });
  return getPlan(ctx, targetId);
}

export async function clientPlans(ctx: Ctx, clientId: string) {
  return listPlans(ctx, { clientId });
}


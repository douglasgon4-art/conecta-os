import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, employees, tasks } from "../db/schema";
import { audit, can, requirePerm, type Ctx } from "../ctx";
import { AppError, forbidden, notFound } from "../errors";
import { Loose, parse, zDate, zRequiredText, zText, zUuid } from "../validation";
import { DEPARTMENTS, TASK_STATUSES, labelOf, values } from "@/lib/domain";
import { notify } from "./notifications";

export const taskInput = z.object({
  title: zRequiredText(200),
  description: zText(4000),
  clientId: zUuid(),
  department: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(DEPARTMENTS)).optional()),
  assigneeId: zUuid(),
  dueDate: zDate(),
  priority: z.enum(["baja", "normal", "alta"]).default("normal"),
});

export async function listTasks(ctx: Ctx, f: { scope?: "mias" | "todas"; status?: string; clientId?: string; assigneeId?: string; overdue?: boolean } = {}) {
  const all = f.scope === "todas" && can(ctx, "tasks.read");
  const conds = [];
  if (!all) {
    if (!ctx.actor.employeeId) return [];
    conds.push(eq(tasks.assigneeId, ctx.actor.employeeId));
  }
  if (f.status === "abiertas" || !f.status) conds.push(inArray(tasks.status, ["pendiente", "en_progreso"]));
  else if (f.status !== "todas") conds.push(eq(tasks.status, f.status));
  if (f.clientId) conds.push(eq(tasks.clientId, f.clientId));
  if (f.assigneeId && all) conds.push(eq(tasks.assigneeId, f.assigneeId));
  if (f.overdue) conds.push(lt(tasks.dueDate, ctx.today));
  return ctx.tx
    .select({ task: tasks, clientName: clients.tradeName, assignee: employees.fullName })
    .from(tasks)
    .leftJoin(clients, eq(clients.id, tasks.clientId))
    .leftJoin(employees, eq(employees.id, tasks.assigneeId))
    .where(and(...conds))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt));
}

export async function createTask(ctx: Ctx, raw: Loose<typeof taskInput>) {
  requirePerm(ctx, "tasks.write");
  const input = parse(taskInput, raw);
  const [task] = await ctx.tx
    .insert(tasks)
    .values({ ...input, description: input.description ?? null, clientId: input.clientId ?? null, department: input.department ?? null, assigneeId: input.assigneeId ?? null, dueDate: input.dueDate ?? null, createdBy: ctx.actor.userId })
    .returning();
  await audit(ctx, { action: "task.create", entityType: "task", entityId: task.id, clientId: task.clientId, summary: `Tarea creada: ${task.title}` });
  if (task.assigneeId) {
    await notify(ctx, { type: "task_assigned", title: `Nueva tarea: ${task.title}`, link: `/tareas`, entityType: "task", entityId: task.id, dedupeKey: `task_assigned:${task.id}:${task.assigneeId}`, employeeIds: [task.assigneeId], broadcast: false });
  }
  return task;
}

async function loadTaskForWrite(ctx: Ctx, id: string) {
  const [t] = await ctx.tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
  if (!t) throw notFound("Tarea");
  if (!can(ctx, "tasks.write")) {
    if (!can(ctx, "tasks.update_own") || !ctx.actor.employeeId || t.assigneeId !== ctx.actor.employeeId) throw forbidden("Solo puedes actualizar tus propias tareas");
  }
  return t;
}

export async function setTaskStatus(ctx: Ctx, id: string, status: string, reason?: string) {
  if (!values(TASK_STATUSES).includes(status as never)) throw new AppError("VALIDATION", "Estado de tarea inválido");
  const before = await loadTaskForWrite(ctx, id);
  if (status === "cancelada" && !can(ctx, "tasks.write")) throw forbidden("Solo quien gestiona tareas puede cancelarlas");
  const [after] = await ctx.tx
    .update(tasks)
    .set({
      status,
      completedAt: status === "completada" ? new Date() : null,
      completedBy: status === "completada" ? ctx.actor.userId : null,
      cancelReason: status === "cancelada" ? (reason ?? "Cancelada") : null,
    })
    .where(eq(tasks.id, id))
    .returning();
  await audit(ctx, { action: "task.status", entityType: "task", entityId: id, clientId: before.clientId, summary: `Tarea "${before.title}": ${labelOf(TASK_STATUSES, before.status)} → ${labelOf(TASK_STATUSES, status)}`, before, after });
  // Cuando se completan todas las tareas de incorporación, el cliente pasa a Activo.
  if (status === "completada" && before.sourceType === "onboarding" && before.clientId) {
    const open = await ctx.tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.clientId, before.clientId), eq(tasks.sourceType, "onboarding"), inArray(tasks.status, ["pendiente", "en_progreso"])));
    const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, before.clientId));
    if (!open.length && client?.status === "en_incorporacion") {
      const { setClientStatus } = await import("./clients");
      await ctx.elevate(() => setClientStatus(ctx, client.id, "activo", "Incorporación completada"));
    }
  }
  return after;
}

/** Asigna una o varias tareas a un colaborador. */
export async function assignTasks(ctx: Ctx, ids: string[], assigneeId: string | null) {
  requirePerm(ctx, "tasks.write");
  if (assigneeId) {
    const [emp] = await ctx.tx.select().from(employees).where(eq(employees.id, assigneeId));
    if (!emp) throw notFound("Colaborador");
  }
  const updated = await ctx.tx.update(tasks).set({ assigneeId }).where(inArray(tasks.id, ids)).returning();
  for (const t of updated) {
    await audit(ctx, { action: "task.assign", entityType: "task", entityId: t.id, clientId: t.clientId, summary: `Tarea "${t.title}" asignada` });
  }
  if (assigneeId && updated.length) {
    await notify(ctx, { type: "task_assigned", title: updated.length === 1 ? `Nueva tarea: ${updated[0].title}` : `Se te asignaron ${updated.length} tareas`, link: "/tareas", dedupeKey: `tasks_assigned:${updated.map((t) => t.id).sort().join(",").slice(0, 200)}:${assigneeId}`, employeeIds: [assigneeId], broadcast: false });
  }
  return updated;
}

export async function overdueTasks(ctx: Ctx) {
  return ctx.tx
    .select({ task: tasks, clientName: clients.tradeName, assignee: employees.fullName })
    .from(tasks)
    .leftJoin(clients, eq(clients.id, tasks.clientId))
    .leftJoin(employees, eq(employees.id, tasks.assigneeId))
    .where(and(inArray(tasks.status, ["pendiente", "en_progreso"]), lt(tasks.dueDate, ctx.today), or(isNull(clients.id), sql`${clients.status} not in ('archivado','dado_de_baja')`)));
}

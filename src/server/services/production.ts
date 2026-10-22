import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  clients,
  contentPlanItems,
  deliverableEvents,
  employees,
  monthlyContentPlans,
  productionBoards,
  productionDeliverables,
  publications,
} from "../db/schema";
import { audit, can, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, forbidden, notFound } from "../errors";
import { Loose, parse, zDate, zText, zUuid } from "../validation";
import { addMonths, firstOfMonth, formatPeriod, lastOfMonth, withDay } from "@/lib/dates";
import {
  COMPLETED_DELIVERABLE_STATUSES,
  completedStatusFor,
  deliverableStatuses,
  initialDeliverableStatus,
  labelOf,
  type BoardStatus,
  type DeliverableKind,
} from "@/lib/domain";
import type { Client, Contract } from "./workspace";
import type { Settings } from "./settings";
import { notify } from "./notifications";

type Deliverable = typeof productionDeliverables.$inferSelect;
type Board = typeof productionBoards.$inferSelect;

const isDone = (d: Pick<Deliverable, "status">) => (COMPLETED_DELIVERABLE_STATUSES as readonly string[]).includes(d.status);
const KIND_TITLE: Record<DeliverableKind, string> = { diseno: "Arte gráfico", perfil: "Foto de perfil", portada: "Portada", reel: "Reel" };

// ───────────────────────── Generación ─────────────────────────

export function plannedDeliverables(contract: Pick<Contract, "designsPerMonth" | "reelsPerMonth" | "includeProfilePhoto" | "includeCover">) {
  const list: { kind: DeliverableKind; position: number; title: string }[] = [];
  for (let i = 1; i <= contract.designsPerMonth; i++) list.push({ kind: "diseno", position: i, title: `Arte gráfico ${i}` });
  if (contract.includeProfilePhoto) list.push({ kind: "perfil", position: 1, title: "Foto de perfil" });
  if (contract.includeCover) list.push({ kind: "portada", position: 1, title: "Portada" });
  for (let i = 1; i <= contract.reelsPerMonth; i++) list.push({ kind: "reel", position: i, title: `Reel ${i}` });
  return list;
}

/** Crea (si no existe) el tablero del cliente para el período y sus entregables según el contrato. */
export async function ensureBoard(ctx: Ctx, client: Client, contract: Contract, period: string, settings: Settings) {
  const planned = plannedDeliverables(contract);
  if (!planned.length) return null;
  const [prev] = await ctx.tx
    .select({ designerId: productionBoards.designerId, editorId: productionBoards.editorId })
    .from(productionBoards)
    .where(and(eq(productionBoards.clientId, client.id), eq(productionBoards.period, addMonths(period, -1))));
  const inserted = await ctx.tx
    .insert(productionBoards)
    .values({
      clientId: client.id,
      contractId: contract.id,
      period,
      designerId: prev?.designerId ?? null,
      editorId: prev?.editorId ?? null,
      dueDate: withDay(period, settings.production_due_day),
      createdBy: ctx.actor.userId,
    })
    .onConflictDoNothing()
    .returning();
  const board =
    inserted[0] ??
    (await ctx.tx.select().from(productionBoards).where(and(eq(productionBoards.clientId, client.id), eq(productionBoards.period, period))))[0];
  if (board.cancelledAt) return { board, created: false, deliverablesCreated: 0 };
  const rows = await ctx.tx
    .insert(productionDeliverables)
    .values(
      planned.map((p) => ({
        boardId: board.id,
        clientId: client.id,
        kind: p.kind,
        position: p.position,
        title: p.title,
        status: initialDeliverableStatus(p.kind),
        assigneeId: p.kind === "reel" ? board.editorId : board.designerId,
        dueDate: board.dueDate,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: productionDeliverables.id });
  return { board, created: inserted.length > 0, deliverablesCreated: rows.length };
}

// ───────────────────────── Cálculo de avance ─────────────────────────

export type BoardProgress = {
  total: number;
  done: number;
  designs: { done: number; total: number };
  profileCover: { done: number; total: number };
  reels: { done: number; total: number };
  progress: number; // 0..1
  status: BoardStatus;
  delayed: boolean;
  overdueCount: number;
};

/** Estado calculado del tablero. Solo cuentan los entregables realmente terminados (con archivo final). */
export function computeBoardProgress(board: Pick<Board, "period" | "dueDate">, items: Pick<Deliverable, "kind" | "status" | "dueDate" | "countsTowardProgress">[], today: string): BoardProgress {
  const counted = items.filter((d) => d.countsTowardProgress);
  const tally = (kinds: string[]) => {
    const xs = counted.filter((d) => kinds.includes(d.kind));
    return { done: xs.filter(isDone).length, total: xs.length };
  };
  const total = counted.length;
  const done = counted.filter(isDone).length;
  const open = counted.filter((d) => !isDone(d));
  const overdue = open.filter((d) => {
    const due = d.dueDate ?? board.dueDate;
    return due !== null && due < today;
  });
  const delayed = overdue.length > 0;
  let status: BoardStatus;
  if (total > 0 && done === total) status = "listo_para_publicar";
  else if (delayed) status = lastOfMonth(board.period) < today ? "produccion_incompleta" : "con_retraso";
  else if (done === 0 && open.every((d) => d.status === initialDeliverableStatus(d.kind as DeliverableKind))) status = "pendiente";
  else if (open.length > 0 && open.every((d) => ["revision_interna", "aprobado"].includes(d.status))) status = "en_revision";
  else status = "en_produccion";
  return {
    total,
    done,
    designs: tally(["diseno"]),
    profileCover: tally(["perfil", "portada"]),
    reels: tally(["reel"]),
    progress: total ? done / total : 0,
    status,
    delayed,
    overdueCount: overdue.length,
  };
}

// ───────────────────────── Consultas ─────────────────────────

export async function productionOverview(
  ctx: Ctx,
  f: { period: string; clientId?: string; designerId?: string; editorId?: string; status?: string; delayedOnly?: boolean },
) {
  requirePerm(ctx, "production.read");
  const period = firstOfMonth(f.period);
  const conds = [eq(productionBoards.period, period), isNull(productionBoards.cancelledAt)];
  if (f.clientId) conds.push(eq(productionBoards.clientId, f.clientId));
  if (f.designerId) conds.push(eq(productionBoards.designerId, f.designerId));
  if (f.editorId) conds.push(eq(productionBoards.editorId, f.editorId));
  const designer = sql<string | null>`(select full_name from employees e where e.id = ${productionBoards.designerId})`;
  const editor = sql<string | null>`(select full_name from employees e where e.id = ${productionBoards.editorId})`;
  const boards = await ctx.tx
    .select({ board: productionBoards, clientName: clients.tradeName, clientStatus: clients.status, designer, editor })
    .from(productionBoards)
    .innerJoin(clients, eq(clients.id, productionBoards.clientId))
    .where(and(...conds))
    .orderBy(asc(clients.tradeName));
  if (!boards.length) return [];
  const items = await ctx.tx
    .select()
    .from(productionDeliverables)
    .where(inArray(productionDeliverables.boardId, boards.map((b) => b.board.id)));
  const byBoard = new Map<string, Deliverable[]>();
  items.forEach((d) => byBoard.set(d.boardId, [...(byBoard.get(d.boardId) ?? []), d]));
  return boards
    .map((b) => ({
      ...b.board,
      clientName: b.clientName,
      clientStatus: b.clientStatus,
      designer: b.designer,
      editor: b.editor,
      ...computeBoardProgress(b.board, byBoard.get(b.board.id) ?? [], ctx.today),
    }))
    .filter((r) => (!f.status || r.status === f.status) && (!f.delayedOnly || r.delayed));
}

export async function getBoard(ctx: Ctx, id: string) {
  requirePerm(ctx, "production.read");
  const [row] = await ctx.tx
    .select({ board: productionBoards, clientName: clients.tradeName, clientStatus: clients.status })
    .from(productionBoards)
    .innerJoin(clients, eq(clients.id, productionBoards.clientId))
    .where(eq(productionBoards.id, id));
  if (!row) throw notFound("Tablero");
  const items = await ctx.tx
    .select({ d: productionDeliverables, assignee: employees.fullName })
    .from(productionDeliverables)
    .leftJoin(employees, eq(employees.id, productionDeliverables.assigneeId))
    .where(eq(productionDeliverables.boardId, id))
    .orderBy(
      sql`case ${productionDeliverables.kind} when 'diseno' then 1 when 'perfil' then 2 when 'portada' then 3 else 4 end`,
      asc(productionDeliverables.position),
      asc(productionDeliverables.platform),
    );
  const events = await ctx.tx
    .select({ e: deliverableEvents, title: productionDeliverables.title })
    .from(deliverableEvents)
    .innerJoin(productionDeliverables, eq(productionDeliverables.id, deliverableEvents.deliverableId))
    .where(eq(productionDeliverables.boardId, id))
    .orderBy(desc(deliverableEvents.createdAt))
    .limit(100);
  const deliverables = items.map((i) => ({ ...i.d, assignee: i.assignee }));
  return {
    ...row.board,
    clientName: row.clientName,
    clientStatus: row.clientStatus,
    deliverables,
    events: events.map((e) => ({ ...e.e, title: e.title })),
    ...computeBoardProgress(row.board, deliverables, ctx.today),
  };
}

export async function getBoardByClientPeriod(ctx: Ctx, clientId: string, period: string) {
  const [b] = await ctx.tx
    .select({ id: productionBoards.id })
    .from(productionBoards)
    .where(and(eq(productionBoards.clientId, clientId), eq(productionBoards.period, firstOfMonth(period))));
  return b ? getBoard(ctx, b.id) : null;
}

export async function clientBoards(ctx: Ctx, clientId: string) {
  requirePerm(ctx, "production.read");
  const boards = await ctx.tx.select().from(productionBoards).where(eq(productionBoards.clientId, clientId)).orderBy(desc(productionBoards.period));
  if (!boards.length) return [];
  const items = await ctx.tx.select().from(productionDeliverables).where(inArray(productionDeliverables.boardId, boards.map((b) => b.id)));
  return boards.map((b) => ({ ...b, ...computeBoardProgress(b, items.filter((i) => i.boardId === b.id), ctx.today) }));
}

/** Entregables asignados al colaborador del usuario (vista "Mis entregables"). */
export async function myDeliverables(ctx: Ctx, opts: { includeDone?: boolean } = {}) {
  if (!ctx.actor.employeeId) return [];
  const conds = [eq(productionDeliverables.assigneeId, ctx.actor.employeeId), isNull(productionBoards.cancelledAt)];
  if (!opts.includeDone) conds.push(sql`${productionDeliverables.status} not in ('finalizado','editado')`);
  return ctx.tx
    .select({ d: productionDeliverables, clientName: clients.tradeName, period: productionBoards.period })
    .from(productionDeliverables)
    .innerJoin(productionBoards, eq(productionBoards.id, productionDeliverables.boardId))
    .innerJoin(clients, eq(clients.id, productionDeliverables.clientId))
    .where(and(...conds))
    .orderBy(asc(productionDeliverables.dueDate), asc(clients.tradeName));
}

/** Clientes cuyo tablero está completo: contenido habilitado para Community Management. */
export async function readyToPublish(ctx: Ctx, period?: string) {
  requirePerm(ctx, "production.read", "publications.read");
  const conds = [sql`${productionBoards.readyAt} is not null`, isNull(productionBoards.cancelledAt)];
  if (period) conds.push(eq(productionBoards.period, firstOfMonth(period)));
  return ctx.tx
    .select({ id: productionBoards.id, period: productionBoards.period, readyAt: productionBoards.readyAt, clientId: clients.id, clientName: clients.tradeName })
    .from(productionBoards)
    .innerJoin(clients, eq(clients.id, productionBoards.clientId))
    .where(and(...conds))
    .orderBy(desc(productionBoards.readyAt));
}

// ───────────────────────── Actualizaciones ─────────────────────────

export const deliverableUpdateInput = z.object({
  status: zText(40),
  assigneeId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
  dueDate: zDate(),
  finalFileUrl: z.preprocess(
    (v) => (v === "" ? null : v),
    z.union([z.url("Enlace inválido"), z.string().regex(/^\/api\/archivos\/[0-9a-f-]{36}$/)]).nullable().optional(),
  ),
  finalFileAssetId: zUuid(),
  title: zText(200),
  scriptRef: zText(4000),
  notes: zText(4000),
});
export type DeliverableUpdate = Loose<typeof deliverableUpdateInput>;

async function loadDeliverableForWrite(ctx: Ctx, id: string) {
  const [row] = await ctx.tx
    .select({ d: productionDeliverables, board: productionBoards, clientName: clients.tradeName, clientStatus: clients.status })
    .from(productionDeliverables)
    .innerJoin(productionBoards, eq(productionBoards.id, productionDeliverables.boardId))
    .innerJoin(clients, eq(clients.id, productionDeliverables.clientId))
    .where(eq(productionDeliverables.id, id))
    .for("update", { of: productionDeliverables });
  if (!row) throw notFound("Entregable");
  if (row.board.cancelledAt) throw conflict("El tablero de este período está cancelado");
  const manage = can(ctx, "production.manage");
  if (!manage) {
    if (!can(ctx, "production.update_own")) throw forbidden();
    if (!ctx.actor.employeeId || row.d.assigneeId !== ctx.actor.employeeId) {
      throw forbidden("Solo puedes actualizar los entregables asignados a ti");
    }
  }
  return { ...row, manage };
}

export async function updateDeliverable(ctx: Ctx, id: string, raw: DeliverableUpdate, opts: { note?: string } = {}) {
  const input = parse(deliverableUpdateInput, raw);
  const { d: before, board, clientName, manage } = await loadDeliverableForWrite(ctx, id);
  const kind = before.kind as DeliverableKind;
  if (!manage && (input.assigneeId !== undefined || input.dueDate !== undefined)) {
    throw forbidden("Solo quien gestiona producción puede reasignar o cambiar fechas límite");
  }
  if (input.status && !deliverableStatuses(kind).some((s) => s.value === input.status)) {
    throw new AppError("VALIDATION", `Estado no válido para ${KIND_TITLE[kind].toLowerCase()}: ${input.status}`);
  }
  const patch: Partial<typeof productionDeliverables.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  const finalUrl = patch.finalFileUrl !== undefined ? patch.finalFileUrl : before.finalFileUrl;
  const finalAsset = patch.finalFileAssetId !== undefined ? patch.finalFileAssetId : before.finalFileAssetId;
  const nextStatus = patch.status ?? before.status;
  const completing = (COMPLETED_DELIVERABLE_STATUSES as readonly string[]).includes(nextStatus);
  if (completing && !finalUrl && !finalAsset) {
    throw new AppError("VALIDATION", `No se puede marcar "${before.title}" como terminado: falta el archivo final o enlace`);
  }
  if (completing && !isDone(before)) {
    patch.completedAt = new Date();
    patch.completedBy = ctx.actor.userId;
  } else if (!completing && isDone(before)) {
    patch.completedAt = null;
    patch.completedBy = null;
  }
  if (!Object.keys(patch).length) return before;
  const [after] = await ctx.tx.update(productionDeliverables).set(patch).where(eq(productionDeliverables.id, id)).returning();
  const changes = Object.fromEntries(
    Object.keys(patch)
      .filter((k) => !["completedAt", "completedBy"].includes(k))
      .map((k) => [k, { from: (before as Record<string, unknown>)[k] ?? null, to: (after as Record<string, unknown>)[k] ?? null }]),
  );
  await ctx.tx.insert(deliverableEvents).values({
    deliverableId: id,
    fromStatus: before.status,
    toStatus: after.status,
    changes,
    note: opts.note ?? null,
    userId: ctx.actor.userId,
  });
  await audit(ctx, {
    action: "deliverable.update",
    entityType: "deliverable",
    entityId: id,
    clientId: before.clientId,
    summary: `${clientName} · ${formatPeriod(board.period)} · ${before.title}: ${labelOf(deliverableStatuses(kind), before.status)} → ${labelOf(deliverableStatuses(kind), after.status)}`,
    before,
    after,
  });
  if (input.assigneeId && input.assigneeId !== before.assigneeId) {
    await notify(ctx, {
      type: "task_assigned",
      title: `Nuevo entregable asignado: ${clientName} · ${after.title}`,
      link: `/produccion/${board.id}`,
      entityType: "deliverable",
      entityId: id,
      dedupeKey: `deliverable_assigned:${id}:${input.assigneeId}`,
      employeeIds: [input.assigneeId],
      broadcast: false,
    });
  }
  await afterBoardChange(ctx, board.id);
  return after;
}

/** Marca un entregable como terminado (Finalizado / Editado). Exige archivo final. */
export async function completeDeliverable(ctx: Ctx, id: string, finalFileUrl?: string) {
  const [d] = await ctx.tx.select({ kind: productionDeliverables.kind }).from(productionDeliverables).where(eq(productionDeliverables.id, id));
  if (!d) throw notFound("Entregable");
  return updateDeliverable(ctx, id, { status: completedStatusFor(d.kind as DeliverableKind), ...(finalFileUrl ? { finalFileUrl } : {}) });
}

/**
 * Acción grupal: marca como terminados los diseños o reels de un tablero.
 * Requiere confirmación explícita y solo completa los que tienen archivo final.
 */
export async function bulkCompleteDeliverables(ctx: Ctx, boardId: string, group: "disenos" | "reels", opts: { confirm?: boolean } = {}) {
  requirePerm(ctx, "production.bulk");
  const kinds = group === "reels" ? ["reel"] : ["diseno"];
  const items = await ctx.tx
    .select()
    .from(productionDeliverables)
    .where(and(eq(productionDeliverables.boardId, boardId), inArray(productionDeliverables.kind, kinds), eq(productionDeliverables.countsTowardProgress, true)));
  const pending = items.filter((d) => !isDone(d));
  const withFile = pending.filter((d) => d.finalFileUrl || d.finalFileAssetId);
  const missing = pending.filter((d) => !d.finalFileUrl && !d.finalFileAssetId);
  if (!opts.confirm) {
    throw new AppError(
      "CONFIRMATION_REQUIRED",
      `Se marcarán ${withFile.length} ${group === "reels" ? "reels como editados" : "diseños como finalizados"}.` +
        (missing.length ? ` ${missing.length} no se pueden completar porque no tienen archivo final.` : ""),
      { willComplete: withFile.map((d) => d.title), missingFile: missing.map((d) => d.title) },
    );
  }
  for (const d of withFile) {
    await updateDeliverable(ctx, d.id, { status: completedStatusFor(d.kind as DeliverableKind) }, { note: "Acción grupal" });
  }
  return { completed: withFile.map((d) => d.title), skippedMissingFile: missing.map((d) => d.title), alreadyDone: items.length - pending.length };
}

export const boardUpdateInput = z.object({
  designerId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
  editorId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
  dueDate: zDate(),
  notes: zText(4000),
});

/** Asignar diseñador/editor al tablero propaga la asignación a los entregables que no tenían otro responsable. */
export async function updateBoard(ctx: Ctx, id: string, raw: Loose<typeof boardUpdateInput>) {
  requirePerm(ctx, "production.manage");
  const input = parse(boardUpdateInput, raw);
  const [before] = await ctx.tx.select().from(productionBoards).where(eq(productionBoards.id, id));
  if (!before) throw notFound("Tablero");
  const patch: Partial<typeof productionBoards.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  const [after] = await ctx.tx.update(productionBoards).set(patch).where(eq(productionBoards.id, id)).returning();
  const cascade = async (field: "designerId" | "editorId", kinds: string[]) => {
    if (input[field] === undefined || input[field] === before[field]) return;
    await ctx.tx
      .update(productionDeliverables)
      .set({ assigneeId: input[field] })
      .where(
        and(
          eq(productionDeliverables.boardId, id),
          inArray(productionDeliverables.kind, kinds),
          before[field] ? or(isNull(productionDeliverables.assigneeId), eq(productionDeliverables.assigneeId, before[field]!)) : isNull(productionDeliverables.assigneeId),
        ),
      );
    if (input[field]) {
      const [client] = await ctx.tx.select({ name: clients.tradeName }).from(clients).where(eq(clients.id, before.clientId));
      await notify(ctx, {
        type: "task_assigned",
        title: `Te asignaron ${field === "designerId" ? "los diseños" : "los reels"} de ${client.name} · ${formatPeriod(before.period)}`,
        link: `/produccion/${id}`,
        dedupeKey: `board_assigned:${id}:${field}:${input[field]}`,
        employeeIds: [input[field]],
        broadcast: false,
      });
    }
  };
  await cascade("designerId", ["diseno", "perfil", "portada"]);
  await cascade("editorId", ["reel"]);
  if (input.dueDate && input.dueDate !== before.dueDate) {
    await ctx.tx
      .update(productionDeliverables)
      .set({ dueDate: input.dueDate })
      .where(and(eq(productionDeliverables.boardId, id), before.dueDate ? eq(productionDeliverables.dueDate, before.dueDate) : isNull(productionDeliverables.dueDate)));
  }
  await audit(ctx, { action: "board.update", entityType: "production_board", entityId: id, clientId: before.clientId, summary: `Tablero ${formatPeriod(before.period)} actualizado`, before, after });
  return after;
}

/** Variante de perfil/portada por plataforma: se registra individualmente y no cuenta como arte adicional. */
export async function addPlatformVariant(ctx: Ctx, boardId: string, kind: "perfil" | "portada", platform: string) {
  requirePerm(ctx, "production.manage");
  const [board] = await ctx.tx.select().from(productionBoards).where(eq(productionBoards.id, boardId));
  if (!board) throw notFound("Tablero");
  const [row] = await ctx.tx
    .insert(productionDeliverables)
    .values({
      boardId,
      clientId: board.clientId,
      kind,
      position: 1,
      platform,
      title: `${KIND_TITLE[kind]} (${platform})`,
      countsTowardProgress: false,
      status: "pendiente",
      assigneeId: board.designerId,
      dueDate: board.dueDate,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new AppError("DUPLICATE", "Esa variante ya existe en el tablero");
  await audit(ctx, { action: "deliverable.variant", entityType: "deliverable", entityId: row.id, clientId: board.clientId, summary: `Variante agregada: ${row.title}` });
  return row;
}

/**
 * Tras cada cambio: si todo el paquete está terminado, el tablero pasa a "Listo para publicar",
 * se habilita el contenido para Community Management y se notifica. Si deja de estarlo, se revierte.
 */
export async function afterBoardChange(ctx: Ctx, boardId: string) {
  const [board] = await ctx.tx.select().from(productionBoards).where(eq(productionBoards.id, boardId));
  const items = await ctx.tx.select().from(productionDeliverables).where(eq(productionDeliverables.boardId, boardId));
  const p = computeBoardProgress(board, items, ctx.today);
  const complete = p.total > 0 && p.done === p.total;
  if (complete && !board.readyAt) {
    await ctx.tx.update(productionBoards).set({ readyAt: new Date() }).where(eq(productionBoards.id, boardId));
    const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, board.clientId));
    const pubs = await createPublicationsFromPlan(ctx, board, client);
    await audit(ctx, {
      action: "board.ready",
      entityType: "production_board",
      entityId: boardId,
      clientId: board.clientId,
      summary: `${client.tradeName} · ${formatPeriod(board.period)}: producción completa (${p.done}/${p.total}). Listo para publicar.`,
    });
    await notify(ctx, {
      type: "content_ready",
      severity: "success",
      title: `Contenido listo para publicar: ${client.tradeName}`,
      body: `${formatPeriod(board.period)} · ${p.done}/${p.total} entregables terminados${pubs ? ` · ${pubs} publicaciones preparadas` : ""}.`,
      link: `/produccion/${boardId}`,
      entityType: "production_board",
      entityId: boardId,
      dedupeKey: `board_ready:${boardId}`,
      employeeIds: [client.communityManagerId],
    });
  } else if (!complete && board.readyAt) {
    await ctx.tx.update(productionBoards).set({ readyAt: null }).where(eq(productionBoards.id, boardId));
  }
  await refreshPlanStatus(ctx, board, p, items);
  return p;
}

async function refreshPlanStatus(ctx: Ctx, board: Board, p: BoardProgress, items: Deliverable[]) {
  const [plan] = await ctx.tx
    .select()
    .from(monthlyContentPlans)
    .where(and(eq(monthlyContentPlans.clientId, board.clientId), eq(monthlyContentPlans.period, board.period)));
  if (!plan || !["aprobada", "en_produccion", "completada"].includes(plan.status)) return;
  const started = items.some((d) => d.status !== initialDeliverableStatus(d.kind as DeliverableKind));
  const next = p.status === "listo_para_publicar" ? "completada" : started ? "en_produccion" : "aprobada";
  if (next !== plan.status) await ctx.tx.update(monthlyContentPlans).set({ status: next }).where(eq(monthlyContentPlans.id, plan.id));
}

/** Prepara publicaciones a partir de las fechas tentativas de la planificación (sin duplicar). */
async function createPublicationsFromPlan(ctx: Ctx, board: Board, client: Client) {
  const { getActiveContract } = await import("./workspace");
  const contract = await getActiveContract(ctx, client.id);
  const networks = contract?.includeCommunity ? contract.socialNetworks : [];
  if (!networks.length) return 0;
  const rows = await ctx.tx
    .select({ d: productionDeliverables, item: contentPlanItems })
    .from(productionDeliverables)
    .innerJoin(contentPlanItems, eq(contentPlanItems.id, productionDeliverables.planItemId))
    .where(and(eq(productionDeliverables.boardId, board.id), sql`${contentPlanItems.tentativePublishDate} is not null`));
  let created = 0;
  for (const { d, item } of rows) {
    const res = await ctx.tx
      .insert(publications)
      .values(
        networks.map((network) => ({
          clientId: client.id,
          deliverableId: d.id,
          network,
          scheduledDate: item.tentativePublishDate!,
          contentTitle: d.title,
          caption: item.cta ?? null,
          status: "lista_programar",
          responsibleId: client.communityManagerId,
          createdBy: ctx.actor.userId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: publications.id });
    created += res.length;
  }
  return created;
}

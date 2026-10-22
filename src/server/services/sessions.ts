import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, contentSessionEvents, contentSessions, employees, productionBoards, productionDeliverables } from "../db/schema";
import { audit, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, notFound } from "../errors";
import { Loose, parse, zDate, zRequiredDate, zText, zTime } from "../validation";
import { addDays, addMonths, diffDays, firstOfMonth, formatDate } from "@/lib/dates";
import { OPEN_SESSION_STATUSES, OPERATIVE_CLIENT_STATUSES, SESSION_STATUSES, labelOf, values, type SessionStatus, type Tone } from "@/lib/domain";
import { getSettings, type Settings } from "./settings";
import { getActiveContract } from "./workspace";

type Session = typeof contentSessions.$inferSelect;

/** Fecha efectiva para el calendario: confirmada > propuesta > prevista. */
export const sessionDate = (s: Pick<Session, "confirmedDate" | "proposedDate" | "expectedDate" | "completedDate" | "status">) =>
  s.status === "realizada" ? s.completedDate! : (s.confirmedDate ?? s.proposedDate ?? s.expectedDate);

export type SessionAlert = { tone: Tone; label: string; attention: boolean };

/**
 * Semáforo de la sesión:
 *  verde = confirmada · amarillo = se aproxima la coordinación / en coordinación
 *  rojo = coordinación atrasada, faltan pocos días sin confirmar o sesión prevista vencida.
 */
export function sessionAlert(s: Pick<Session, "status" | "expectedDate" | "coordinationStartDate" | "confirmedDate" | "proposedDate">, today: string, settings: Pick<Settings, "session_coordination_notice_days" | "session_urgent_days">): SessionAlert {
  if (s.status === "realizada") return { tone: "green", label: "Realizada", attention: false };
  if (s.status === "cancelada") return { tone: "gray", label: "Cancelada", attention: false };
  if (s.status === "confirmada" && s.confirmedDate) {
    if (s.confirmedDate < today) return { tone: "red", label: `Confirmada para el ${formatDate(s.confirmedDate)}: registrar si se realizó`, attention: true };
    return { tone: "green", label: `Confirmada · ${formatDate(s.confirmedDate)}`, attention: false };
  }
  const target = s.proposedDate ?? s.expectedDate;
  const daysToSession = diffDays(target, today);
  const daysToCoordination = diffDays(s.coordinationStartDate, today);
  if (daysToSession < 0) return { tone: "red", label: `Sesión prevista vencida hace ${-daysToSession} día(s); revisar`, attention: true };
  if (daysToSession === 0) return { tone: "red", label: "La sesión prevista es hoy y no está confirmada", attention: true };
  if (daysToSession <= settings.session_urgent_days) return { tone: "red", label: `Faltan ${daysToSession} día(s) y no se ha confirmado la fecha`, attention: true };
  if (daysToCoordination < 0 && s.status === "pendiente_coordinar") return { tone: "red", label: `Coordinación atrasada ${-daysToCoordination} día(s)`, attention: true };
  if (daysToCoordination <= 0) return { tone: "yellow", label: `En coordinación · faltan ${daysToSession} día(s)`, attention: true };
  if (daysToCoordination <= settings.session_coordination_notice_days) return { tone: "yellow", label: `Comenzar a coordinar en ${daysToCoordination} día(s)`, attention: true };
  return { tone: "gray", label: `Prevista para el ${formatDate(s.expectedDate)}`, attention: false };
}

const withNames = () => ({
  s: contentSessions,
  clientName: clients.tradeName,
  clientStatus: clients.status,
  responsible: employees.fullName,
});

export async function listSessions(ctx: Ctx, f: { from?: string; to?: string; clientId?: string; responsibleId?: string; status?: string } = {}) {
  requirePerm(ctx, "sessions.read");
  const effective = sql<string>`case when ${contentSessions.status} = 'realizada' then ${contentSessions.completedDate} else coalesce(${contentSessions.confirmedDate}, ${contentSessions.proposedDate}, ${contentSessions.expectedDate}) end`;
  const conds = [];
  if (f.from) conds.push(gte(effective, f.from));
  if (f.to) conds.push(lte(effective, f.to));
  if (f.clientId) conds.push(eq(contentSessions.clientId, f.clientId));
  if (f.responsibleId) conds.push(eq(contentSessions.responsibleId, f.responsibleId));
  if (f.status) conds.push(eq(contentSessions.status, f.status));
  const settings = await getSettings(ctx);
  const rows = await ctx.tx
    .select(withNames())
    .from(contentSessions)
    .innerJoin(clients, eq(clients.id, contentSessions.clientId))
    .leftJoin(employees, eq(employees.id, contentSessions.responsibleId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(effective));
  const list = rows.map((r) => ({ ...r.s, clientName: r.clientName, clientStatus: r.clientStatus, responsible: r.responsible, date: sessionDate(r.s), alert: sessionAlert(r.s, ctx.today, settings) }));
  return markConflicts(list);
}

/** Marca conflictos de horario: mismo responsable, misma fecha y horarios que se solapan (o sin horario). */
function markConflicts<T extends { id: string; date: string; responsibleId: string | null; startTime: string | null; endTime: string | null; status: string }>(list: T[]) {
  const active = list.filter((s) => s.status !== "cancelada" && s.responsibleId);
  return list.map((s) => {
    const conflicts = active.filter(
      (o) =>
        o.id !== s.id &&
        s.status !== "cancelada" &&
        o.responsibleId === s.responsibleId &&
        o.date === s.date &&
        (!s.startTime || !o.startTime || (s.startTime < (o.endTime ?? "23:59") && o.startTime < (s.endTime ?? "23:59"))),
    );
    return { ...s, conflicts: conflicts.map((c) => c.id) };
  });
}

/** Lista "Sesiones que requieren atención" para clientes en operación. */
export async function sessionsNeedingAttention(ctx: Ctx) {
  requirePerm(ctx, "sessions.read");
  const settings = await getSettings(ctx);
  const rows = await ctx.tx
    .select(withNames())
    .from(contentSessions)
    .innerJoin(clients, eq(clients.id, contentSessions.clientId))
    .leftJoin(employees, eq(employees.id, contentSessions.responsibleId))
    .where(and(inArray(contentSessions.status, OPEN_SESSION_STATUSES), inArray(clients.status, OPERATIVE_CLIENT_STATUSES)));
  return rows
    .map((r) => ({ ...r.s, clientName: r.clientName, responsible: r.responsible, date: sessionDate(r.s), alert: sessionAlert(r.s, ctx.today, settings) }))
    .filter((r) => r.alert.attention)
    .sort((a, b) => (a.alert.tone === b.alert.tone ? a.date.localeCompare(b.date) : a.alert.tone === "red" ? -1 : 1));
}

export async function getSession(ctx: Ctx, id: string) {
  requirePerm(ctx, "sessions.read");
  const [row] = await ctx.tx
    .select(withNames())
    .from(contentSessions)
    .innerJoin(clients, eq(clients.id, contentSessions.clientId))
    .leftJoin(employees, eq(employees.id, contentSessions.responsibleId))
    .where(eq(contentSessions.id, id));
  if (!row) throw notFound("Sesión");
  const events = await ctx.tx.select().from(contentSessionEvents).where(eq(contentSessionEvents.sessionId, id)).orderBy(desc(contentSessionEvents.createdAt));
  const settings = await getSettings(ctx);
  return { ...row.s, clientName: row.clientName, responsible: row.responsible, date: sessionDate(row.s), alert: sessionAlert(row.s, ctx.today, settings), events };
}

export async function clientSessions(ctx: Ctx, clientId: string) {
  requirePerm(ctx, "sessions.read");
  const settings = await getSettings(ctx);
  const rows = await ctx.tx
    .select({ s: contentSessions, responsible: employees.fullName })
    .from(contentSessions)
    .leftJoin(employees, eq(employees.id, contentSessions.responsibleId))
    .where(eq(contentSessions.clientId, clientId))
    .orderBy(desc(contentSessions.expectedDate));
  const list = rows.map((r) => ({ ...r.s, responsible: r.responsible, date: sessionDate(r.s), alert: sessionAlert(r.s, ctx.today, settings) }));
  const last = list.find((s) => s.status === "realizada") ?? null;
  const next = [...list].reverse().find((s) => OPEN_SESSION_STATUSES.includes(s.status as SessionStatus)) ?? null;
  return { sessions: list, last, next };
}

async function recordEvent(ctx: Ctx, before: Session, after: Session, note?: string | null) {
  const keys = ["status", "expectedDate", "proposedDate", "confirmedDate", "completedDate", "startTime", "endTime", "location", "responsibleId", "notes", "clientContact"] as const;
  const changes = Object.fromEntries(keys.filter((k) => before[k] !== after[k]).map((k) => [k, { from: before[k], to: after[k] }]));
  if (!Object.keys(changes).length && !note) return;
  await ctx.tx.insert(contentSessionEvents).values({ sessionId: after.id, fromStatus: before.status, toStatus: after.status, changes, note: note ?? null, userId: ctx.actor.userId });
}

export const sessionUpdateInput = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(SESSION_STATUSES)).optional()),
  proposedDate: zDate(),
  confirmedDate: zDate(),
  startTime: zTime(),
  endTime: zTime(),
  location: zText(300),
  responsibleId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable().optional()),
  clientContact: zText(200),
  notes: zText(2000),
  note: zText(500),
});

/**
 * Actualiza una sesión conservando el historial. Distingue fecha propuesta y confirmada.
 * Cambiar la fecha de una sesión confirmada la marca como reprogramada (con historial) y queda confirmada en la nueva fecha.
 * "Realizada" y "Cancelada" tienen sus propias acciones.
 */
export async function updateSession(ctx: Ctx, id: string, raw: Loose<typeof sessionUpdateInput>) {
  requirePerm(ctx, "sessions.write");
  const input = parse(sessionUpdateInput, raw);
  const [before] = await ctx.tx.select().from(contentSessions).where(eq(contentSessions.id, id)).for("update");
  if (!before) throw notFound("Sesión");
  if (["realizada", "cancelada"].includes(before.status)) throw conflict(`La sesión ya está ${labelOf(SESSION_STATUSES, before.status).toLowerCase()}`);
  if (input.status === "realizada") throw new AppError("VALIDATION", "Usa «Registrar sesión realizada» indicando la fecha en que se realizó");
  if (input.status === "cancelada") throw new AppError("VALIDATION", "Usa «Cancelar sesión» indicando el motivo");
  const patch: Partial<typeof contentSessions.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (k !== "note" && v !== undefined) (patch as Record<string, unknown>)[k] = v;
  let note = input.note ?? null;
  if (input.proposedDate && !input.status && !input.confirmedDate) patch.status = "fecha_propuesta";
  if (input.confirmedDate) {
    if (before.status === "confirmada" && before.confirmedDate && before.confirmedDate !== input.confirmedDate) {
      note = [note, `Reprogramada del ${formatDate(before.confirmedDate)} al ${formatDate(input.confirmedDate)}`].filter(Boolean).join(" · ");
    }
    if (!input.status || input.status === "reprogramada") patch.status = "confirmada";
  }
  if (patch.status === "confirmada" && !(patch.confirmedDate ?? before.confirmedDate)) {
    throw new AppError("VALIDATION", "Para confirmar la sesión indica la fecha confirmada");
  }
  const [after] = await ctx.tx.update(contentSessions).set(patch).where(eq(contentSessions.id, id)).returning();
  await recordEvent(ctx, before, after, note);
  const [client] = await ctx.tx.select({ name: clients.tradeName }).from(clients).where(eq(clients.id, before.clientId));
  await audit(ctx, {
    action: "session.update",
    entityType: "content_session",
    entityId: id,
    clientId: before.clientId,
    summary: `Sesión de ${client.name}: ${labelOf(SESSION_STATUSES, before.status)} → ${labelOf(SESSION_STATUSES, after.status)}${after.confirmedDate ? ` · ${formatDate(after.confirmedDate)}` : ""}${note ? ` (${note})` : ""}`,
    before,
    after,
  });
  return after;
}

export const scheduleInput = z.object({
  clientId: z.uuid(),
  date: zRequiredDate(),
  confirmed: z.boolean().default(true),
  startTime: zTime(),
  endTime: zTime(),
  location: zText(300),
  responsibleId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  notes: zText(2000),
});

/**
 * Programa la sesión de un cliente. Si ya tiene una sesión abierta, la actualiza (no crea duplicados);
 * si no, crea una sesión manual.
 */
export async function scheduleSession(ctx: Ctx, raw: Loose<typeof scheduleInput>) {
  requirePerm(ctx, "sessions.write");
  const input = parse(scheduleInput, raw);
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, input.clientId));
  if (!client) throw notFound("Cliente");
  if (!OPERATIVE_CLIENT_STATUSES.includes(client.status as never)) throw conflict(`${client.tradeName} no está en un estado operativo`);
  const [open] = await ctx.tx
    .select()
    .from(contentSessions)
    .where(and(eq(contentSessions.clientId, input.clientId), inArray(contentSessions.status, OPEN_SESSION_STATUSES)))
    .orderBy(asc(contentSessions.expectedDate))
    .limit(1);
  const details = {
    startTime: input.startTime,
    endTime: input.endTime,
    location: input.location,
    responsibleId: input.responsibleId,
    notes: input.notes,
  };
  if (open) {
    const session = await updateSession(ctx, open.id, input.confirmed ? { ...details, confirmedDate: input.date } : { ...details, proposedDate: input.date });
    return { session, created: false };
  }
  const contract = await getActiveContract(ctx, input.clientId);
  const lead = contract?.coordinationLeadDays ?? (await getSettings(ctx)).default_coordination_lead_days;
  const [session] = await ctx.tx
    .insert(contentSessions)
    .values({
      clientId: input.clientId,
      contractId: contract?.id ?? null,
      expectedDate: input.date,
      coordinationStartDate: addDays(input.date, -lead),
      proposedDate: input.confirmed ? null : input.date,
      confirmedDate: input.confirmed ? input.date : null,
      status: input.confirmed ? "confirmada" : "fecha_propuesta",
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      location: input.location ?? null,
      responsibleId: input.responsibleId ?? null,
      clientContact: client.contactName,
      notes: input.notes ?? null,
      generationKey: `manual:${input.clientId}:${input.date}:${Date.now()}`,
      createdBy: ctx.actor.userId,
    })
    .returning();
  await ctx.tx.insert(contentSessionEvents).values({ sessionId: session.id, toStatus: session.status, note: "Sesión programada", userId: ctx.actor.userId });
  await audit(ctx, { action: "session.create", entityType: "content_session", entityId: session.id, clientId: client.id, summary: `Sesión programada para ${client.tradeName}: ${formatDate(input.date)}` });
  return { session, created: true };
}

/**
 * Registra la sesión como realizada (nunca ocurre sólo porque llegue la fecha).
 * Calcula la siguiente fecha prevista según la periodicidad del contrato y crea la próxima sesión sin duplicarla.
 * El material de los reels del mes queda marcado como recibido.
 */
export async function completeSession(ctx: Ctx, id: string, raw: { completedDate: string; notes?: string }) {
  requirePerm(ctx, "sessions.write");
  const input = parse(z.object({ completedDate: zRequiredDate(), notes: zText(2000) }), raw);
  if (input.completedDate > ctx.today) throw new AppError("VALIDATION", "No se puede registrar como realizada una sesión con fecha futura");
  const [before] = await ctx.tx.select().from(contentSessions).where(eq(contentSessions.id, id)).for("update");
  if (!before) throw notFound("Sesión");
  if (before.status === "realizada") throw conflict("La sesión ya está registrada como realizada");
  if (before.status === "cancelada") throw conflict("La sesión está cancelada");
  const [after] = await ctx.tx
    .update(contentSessions)
    .set({ status: "realizada", completedDate: input.completedDate, notes: input.notes ?? before.notes })
    .where(eq(contentSessions.id, id))
    .returning();
  await recordEvent(ctx, before, after, "Sesión realizada");

  // Vincular con el tablero del mes y marcar el material de video como recibido.
  const [board] = await ctx.tx
    .select()
    .from(productionBoards)
    .where(and(eq(productionBoards.clientId, before.clientId), eq(productionBoards.period, firstOfMonth(input.completedDate))));
  let materialMarked = 0;
  if (board) {
    await ctx.tx.update(contentSessions).set({ boardId: board.id }).where(eq(contentSessions.id, id));
    const updated = await ctx.tx
      .update(productionDeliverables)
      .set({ status: "material_recibido" })
      .where(and(eq(productionDeliverables.boardId, board.id), eq(productionDeliverables.kind, "reel"), eq(productionDeliverables.status, "pendiente_material")))
      .returning({ id: productionDeliverables.id });
    materialMarked = updated.length;
    if (updated.length) {
      const { deliverableEvents } = await import("../db/schema");
      await ctx.tx.insert(deliverableEvents).values(
        updated.map((u) => ({ deliverableId: u.id, fromStatus: "pendiente_material", toStatus: "material_recibido", note: `Sesión del ${formatDate(input.completedDate)} realizada`, userId: ctx.actor.userId })),
      );
    }
  }

  const next = await scheduleNextSession(ctx, after);
  const [client] = await ctx.tx.select({ name: clients.tradeName }).from(clients).where(eq(clients.id, before.clientId));
  await audit(ctx, {
    action: "session.complete",
    entityType: "content_session",
    entityId: id,
    clientId: before.clientId,
    summary: `Sesión de ${client.name} realizada el ${formatDate(input.completedDate)}.${next ? ` Próxima prevista: ${formatDate(next.expectedDate)}.` : ""}`,
    before,
    after,
  });
  return { session: after, next, materialMarked };
}

async function scheduleNextSession(ctx: Ctx, done: Session) {
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, done.clientId));
  if (!OPERATIVE_CLIENT_STATUSES.includes(client.status as never)) return null;
  const contract = await getActiveContract(ctx, done.clientId);
  if (!contract || !contract.sessionsEnabled) return null;
  const expected = addMonths(done.completedDate!, contract.sessionFrequencyMonths);
  if (contract.endDate && expected > contract.endDate) return null;
  const others = await ctx.tx
    .select({ id: contentSessions.id })
    .from(contentSessions)
    .where(and(eq(contentSessions.clientId, done.clientId), inArray(contentSessions.status, OPEN_SESSION_STATUSES), ne(contentSessions.id, done.id)));
  if (others.length) return null; // ya hay una próxima sesión abierta
  const [next] = await ctx.tx
    .insert(contentSessions)
    .values({
      clientId: done.clientId,
      contractId: contract.id,
      expectedDate: expected,
      coordinationStartDate: addDays(expected, -contract.coordinationLeadDays),
      responsibleId: done.responsibleId,
      location: done.location,
      clientContact: done.clientContact,
      previousSessionId: done.id,
      generationKey: `next:${done.id}`,
      createdBy: ctx.actor.userId,
    })
    .onConflictDoNothing()
    .returning();
  return next ?? null;
}

export async function cancelSession(ctx: Ctx, id: string, reason: string, opts: { confirm?: boolean } = {}) {
  requirePerm(ctx, "sessions.write");
  if (!reason?.trim()) throw new AppError("VALIDATION", "Indica el motivo de la cancelación");
  const [before] = await ctx.tx.select().from(contentSessions).where(eq(contentSessions.id, id)).for("update");
  if (!before) throw notFound("Sesión");
  if (["realizada", "cancelada"].includes(before.status)) throw conflict("La sesión ya está cerrada");
  if (before.status === "confirmada" && !opts.confirm) {
    throw new AppError("CONFIRMATION_REQUIRED", `La sesión está confirmada para el ${formatDate(before.confirmedDate)} con el cliente. ¿Confirmas la cancelación?`);
  }
  const [after] = await ctx.tx.update(contentSessions).set({ status: "cancelada" }).where(eq(contentSessions.id, id)).returning();
  await recordEvent(ctx, before, after, `Cancelada: ${reason}`);
  await audit(ctx, { action: "session.cancel", entityType: "content_session", entityId: id, clientId: before.clientId, summary: `Sesión cancelada. Motivo: ${reason}`, before, after });
  return after;
}

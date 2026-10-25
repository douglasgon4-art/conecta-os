import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, dailyPublicationSnapshots, employees, productionBoards, productionDeliverables, publications } from "../db/schema";
import { audit, can, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, forbidden, notFound } from "../errors";
import { Loose, parse, zRequiredDate, zRequiredText, zText, zTime, zUuid } from "../validation";
import { addDays, formatDate, startOfWeek } from "@/lib/dates";
import { PUBLICATION_STATUSES, SOCIAL_NETWORKS, labelOf, values } from "@/lib/domain";
import { getActiveContract } from "./workspace";

type Publication = typeof publications.$inferSelect;
/** Estados que no cuentan como obligación del día. */
const NOT_APPLICABLE = ["no_aplica", "reprogramada"];

export const publicationInput = z.object({
  clientId: z.uuid(),
  network: z.enum(values(SOCIAL_NETWORKS)),
  scheduledDate: zRequiredDate(),
  scheduledTime: zTime(),
  contentTitle: zRequiredText(200),
  caption: zText(4000),
  deliverableId: zUuid(),
  responsibleId: zUuid(),
  status: z.enum(["pendiente", "lista_programar", "programada", "publicada"]).default("pendiente"),
  evidenceUrl: z.preprocess((v) => (v === "" ? undefined : v), z.url("Enlace inválido").optional()),
});

export async function createPublication(ctx: Ctx, raw: Loose<typeof publicationInput>) {
  requirePerm(ctx, "publications.manage", "publications.update_own");
  const input = parse(publicationInput, raw);
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, input.clientId));
  if (!client) throw notFound("Cliente");
  const contract = await getActiveContract(ctx, client.id);
  if (!contract?.includeCommunity || !contract.socialNetworks.includes(input.network)) {
    throw conflict(`${labelOf(SOCIAL_NETWORKS, input.network)} no está incluida en el contrato de ${client.tradeName}`);
  }
  let responsibleId = input.responsibleId ?? client.communityManagerId ?? ctx.actor.employeeId;
  if (!can(ctx, "publications.manage")) {
    if (client.communityManagerId && client.communityManagerId !== ctx.actor.employeeId) throw forbidden("Solo puedes planificar publicaciones de tus clientes");
    responsibleId = ctx.actor.employeeId;
  }
  if (input.deliverableId) {
    const [d] = await ctx.tx.select().from(productionDeliverables).where(eq(productionDeliverables.id, input.deliverableId));
    if (!d || d.clientId !== client.id) throw new AppError("VALIDATION", "El contenido seleccionado no pertenece a este cliente");
  }
  if (!input.deliverableId) {
    const [dup] = await ctx.tx
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(
          eq(publications.clientId, client.id),
          eq(publications.network, input.network),
          eq(publications.scheduledDate, input.scheduledDate),
          sql`lower(trim(${publications.contentTitle})) = lower(trim(${input.contentTitle}))`,
          notInArray(publications.status, ["reprogramada", "no_aplica"]),
        ),
      )
      .limit(1);
    if (dup) throw new AppError("DUPLICATE", "Ese contenido ya está planificado en esa red social para ese día");
  }
  // Registrar algo ya publicado: misma confirmación trazada que al marcarla después (quién y cuándo).
  const published = input.status === "publicada";
  if (published && !ctx.actor.userId) throw new AppError("VALIDATION", "Una publicación solo puede confirmarla una persona usuaria");
  if (published && input.scheduledDate > ctx.today) throw new AppError("VALIDATION", "No se puede marcar como publicada una fecha futura");
  const confirmation = published ? { confirmedBy: ctx.actor.userId, confirmedAt: new Date(), publishedAt: new Date(), verification: "manual" } : {};
  const [pub] = await ctx.tx
    .insert(publications)
    .values({ ...input, ...confirmation, evidenceUrl: input.evidenceUrl ?? null, scheduledTime: input.scheduledTime ?? null, caption: input.caption ?? null, deliverableId: input.deliverableId ?? null, responsibleId, createdBy: ctx.actor.userId })
    .onConflictDoNothing()
    .returning();
  if (!pub) throw new AppError("DUPLICATE", "Ese contenido ya está planificado en esa red social");
  await audit(ctx, { action: "publication.create", entityType: "publication", entityId: pub.id, clientId: client.id, summary: `${published ? "Publicación registrada como publicada" : "Publicación planificada"}: ${client.tradeName} · ${labelOf(SOCIAL_NETWORKS, pub.network)} · ${formatDate(pub.scheduledDate)} · ${pub.contentTitle}` });
  return pub;
}

/**
 * Planifica (o registra como publicado) el mismo contenido en varias redes a la vez.
 * Todo o nada si una red no está en el contrato; las redes donde ya estaba planificado se omiten y se informan.
 */
export async function createPublicationsForNetworks(ctx: Ctx, raw: Loose<typeof publicationInput> & { networks?: unknown }) {
  const networks = [...new Set(([] as unknown[]).concat(raw.networks ?? raw.network ?? []).map(String).filter(Boolean))];
  if (!networks.length) throw new AppError("VALIDATION", "Selecciona al menos una red social");
  const created: (typeof publications.$inferSelect)[] = [];
  const skipped: string[] = [];
  for (const network of networks) {
    try {
      created.push(await ctx.tx.transaction((sp) => createPublication(Object.create(ctx, { tx: { value: sp } }) as Ctx, { ...raw, network: network as never })));
    } catch (e) {
      if (e instanceof AppError && e.code === "DUPLICATE") skipped.push(labelOf(SOCIAL_NETWORKS, network));
      else throw e;
    }
  }
  return { created, skipped };
}

async function loadForWrite(ctx: Ctx, id: string) {
  const [row] = await ctx.tx
    .select({ p: publications, cm: clients.communityManagerId, clientName: clients.tradeName })
    .from(publications)
    .innerJoin(clients, eq(clients.id, publications.clientId))
    .where(eq(publications.id, id))
    .for("update", { of: publications });
  if (!row) throw notFound("Publicación");
  if (!can(ctx, "publications.manage")) {
    if (!can(ctx, "publications.update_own")) throw forbidden();
    const me = ctx.actor.employeeId;
    if (!me || (row.p.responsibleId !== me && row.cm !== me)) throw forbidden("Solo puedes actualizar las publicaciones asignadas a ti");
  }
  return row;
}

export const publicationUpdateInput = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(PUBLICATION_STATUSES)).optional()),
  evidenceUrl: z.preprocess((v) => (v === "" ? null : v), z.url("Enlace inválido").nullable().optional()),
  notes: zText(2000),
  caption: zText(4000),
  scheduledTime: zTime(),
  publishedAt: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional()),
});

/**
 * Actualiza el estado de una publicación. "Publicada" exige confirmación explícita:
 * se guarda quién la confirmó, cuándo y la verificación (manual).
 */
export async function updatePublication(ctx: Ctx, id: string, raw: Loose<typeof publicationUpdateInput>) {
  const input = parse(publicationUpdateInput, raw);
  const { p: before, clientName } = await loadForWrite(ctx, id);
  if (input.status === "reprogramada") throw new AppError("VALIDATION", "Usa «Reprogramar» indicando la nueva fecha");
  if (before.status === "reprogramada") throw conflict("Esta publicación fue reprogramada; actualiza la nueva");
  const patch: Partial<typeof publications.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  if (input.status === "publicada" && before.status !== "publicada") {
    patch.confirmedBy = ctx.actor.userId ?? undefined;
    patch.confirmedAt = new Date();
    patch.publishedAt = input.publishedAt ?? new Date();
    patch.verification = "manual";
    if (!ctx.actor.userId) throw new AppError("VALIDATION", "Una publicación solo puede confirmarla una persona usuaria");
  } else if (input.status && input.status !== "publicada" && before.status === "publicada") {
    patch.confirmedBy = null;
    patch.confirmedAt = null;
    patch.publishedAt = null;
    patch.verification = null;
  }
  const [after] = await ctx.tx.update(publications).set(patch).where(eq(publications.id, id)).returning();
  await audit(ctx, {
    action: "publication.update",
    entityType: "publication",
    entityId: id,
    clientId: before.clientId,
    summary: `${clientName} · ${labelOf(SOCIAL_NETWORKS, before.network)} · ${formatDate(before.scheduledDate)}: ${labelOf(PUBLICATION_STATUSES, before.status)} → ${labelOf(PUBLICATION_STATUSES, after.status)}`,
    before,
    after,
  });
  return after;
}

export async function reschedulePublication(ctx: Ctx, id: string, raw: { scheduledDate: string; scheduledTime?: string; reason?: string }) {
  const input = parse(z.object({ scheduledDate: zRequiredDate(), scheduledTime: zTime(), reason: zText(300) }), raw);
  const { p: before, clientName } = await loadForWrite(ctx, id);
  if (["publicada", "reprogramada", "no_aplica"].includes(before.status)) throw conflict(`No se puede reprogramar una publicación ${labelOf(PUBLICATION_STATUSES, before.status).toLowerCase()}`);
  // Primero se libera el original (para la restricción de unicidad) y luego se crea el nuevo registro.
  await ctx.tx.update(publications).set({ status: "reprogramada", notes: input.reason ?? before.notes }).where(eq(publications.id, id));
  const [created] = await ctx.tx
    .insert(publications)
    .values({
      clientId: before.clientId,
      deliverableId: before.deliverableId,
      network: before.network,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledTime ?? before.scheduledTime,
      contentTitle: before.contentTitle,
      caption: before.caption,
      status: before.status === "fallida" ? "pendiente" : before.status,
      responsibleId: before.responsibleId,
      rescheduledFromId: before.id,
      createdBy: ctx.actor.userId,
    })
    .returning();
  await ctx.tx.update(publications).set({ rescheduledToId: created.id }).where(eq(publications.id, id));
  await audit(ctx, { action: "publication.reschedule", entityType: "publication", entityId: created.id, clientId: before.clientId, summary: `${clientName}: publicación reprogramada del ${formatDate(before.scheduledDate)} al ${formatDate(input.scheduledDate)}` });
  return created;
}

export async function listPublicationsForDay(ctx: Ctx, date: string, f: { clientId?: string; network?: string; responsibleId?: string } = {}) {
  requirePerm(ctx, "publications.read");
  const conds = [eq(publications.scheduledDate, date)];
  if (f.clientId) conds.push(eq(publications.clientId, f.clientId));
  if (f.network) conds.push(eq(publications.network, f.network));
  if (f.responsibleId) conds.push(eq(publications.responsibleId, f.responsibleId));
  return ctx.tx
    .select({ p: publications, clientName: clients.tradeName, responsible: employees.fullName, fileUrl: productionDeliverables.finalFileUrl })
    .from(publications)
    .innerJoin(clients, eq(clients.id, publications.clientId))
    .leftJoin(employees, eq(employees.id, publications.responsibleId))
    .leftJoin(productionDeliverables, eq(productionDeliverables.id, publications.deliverableId))
    .where(and(...conds))
    .orderBy(asc(clients.tradeName), asc(publications.network), asc(publications.scheduledTime));
}

export async function listPublications(ctx: Ctx, f: { from: string; to: string; clientId?: string; responsibleId?: string }) {
  requirePerm(ctx, "publications.read");
  const conds = [gte(publications.scheduledDate, f.from), lte(publications.scheduledDate, f.to)];
  if (f.clientId) conds.push(eq(publications.clientId, f.clientId));
  if (f.responsibleId) conds.push(eq(publications.responsibleId, f.responsibleId));
  return ctx.tx
    .select({ p: publications, clientName: clients.tradeName, responsible: employees.fullName })
    .from(publications)
    .innerJoin(clients, eq(clients.id, publications.clientId))
    .leftJoin(employees, eq(employees.id, publications.responsibleId))
    .where(and(...conds))
    .orderBy(asc(publications.scheduledDate), asc(clients.tradeName));
}

export type Compliance = {
  planned: number;
  published: number;
  failed: number;
  pending: number;
  ratio: number | null;
  clientsPlanned: number;
  clientsCompliant: number;
  clientRatio: number | null;
};

type Agg = { planned: number; published: number; failed: number; pending: number; clientsPlanned: number; clientsCompliant: number };
const toCompliance = (a: Agg): Compliance => ({
  ...a,
  ratio: a.planned ? a.published / a.planned : null,
  clientRatio: a.clientsPlanned ? a.clientsCompliant / a.clientsPlanned : null,
});

/** Agrega el cumplimiento de un conjunto de publicaciones. Solo cuentan las obligaciones aplicables del día. */
function aggregate(rows: Pick<Publication, "status" | "clientId">[]): Agg {
  const applicable = rows.filter((r) => !NOT_APPLICABLE.includes(r.status));
  const byClient = new Map<string, boolean>();
  for (const r of applicable) byClient.set(r.clientId, (byClient.get(r.clientId) ?? true) && r.status === "publicada");
  return {
    planned: applicable.length,
    published: applicable.filter((r) => r.status === "publicada").length,
    failed: applicable.filter((r) => r.status === "fallida").length,
    pending: applicable.filter((r) => !["publicada", "fallida"].includes(r.status)).length,
    clientsPlanned: byClient.size,
    clientsCompliant: [...byClient.values()].filter(Boolean).length,
  };
}

function groupAggregates(rows: Pick<Publication, "status" | "clientId" | "network" | "responsibleId">[]) {
  const scopes = new Map<string, typeof rows>([["total", []]]);
  const add = (k: string, r: (typeof rows)[number]) => scopes.set(k, [...(scopes.get(k) ?? []), r]);
  // Solo las obligaciones aplicables generan alcances: un cliente sin publicación prevista no aparece.
  for (const r of rows.filter((x) => !NOT_APPLICABLE.includes(x.status))) {
    add("total", r);
    add(`network:${r.network}`, r);
    add(`cm:${r.responsibleId ?? "sin_asignar"}`, r);
    add(`client:${r.clientId}`, r);
  }
  return new Map([...scopes.entries()].map(([k, v]) => [k, aggregate(v)]));
}

/**
 * Cumplimiento de un día. Los días cerrados se leen del registro inmutable (no se recalculan),
 * así el 90 % del martes sigue siendo 90 % aunque después se edite algo.
 */
export async function dailyCompliance(ctx: Ctx, date: string) {
  requirePerm(ctx, "publications.read");
  const snaps = await ctx.tx.select().from(dailyPublicationSnapshots).where(eq(dailyPublicationSnapshots.day, date));
  let scopes: Map<string, Agg>;
  let closed = false;
  if (snaps.length) {
    closed = true;
    scopes = new Map(snaps.map((s) => [s.scope, { planned: s.planned, published: s.published, failed: s.failed, pending: s.pending, clientsPlanned: s.clientsPlanned, clientsCompliant: s.clientsCompliant }]));
  } else {
    const rows = await ctx.tx.select().from(publications).where(eq(publications.scheduledDate, date));
    scopes = groupAggregates(rows);
  }
  const names = await scopeNames(ctx, [...scopes.keys()]);
  const pick = (prefix: string) =>
    [...scopes.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ key: k.slice(prefix.length), name: names.get(k) ?? k.slice(prefix.length), ...toCompliance(v) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const total = toCompliance(scopes.get("total") ?? { planned: 0, published: 0, failed: 0, pending: 0, clientsPlanned: 0, clientsCompliant: 0 });
  return { date, closed, total, byNetwork: pick("network:"), byCm: pick("cm:"), byClient: pick("client:") };
}

async function scopeNames(ctx: Ctx, keys: string[]) {
  const names = new Map<string, string>();
  const cmIds = keys.filter((k) => k.startsWith("cm:") && k !== "cm:sin_asignar").map((k) => k.slice(3));
  const clientIds = keys.filter((k) => k.startsWith("client:")).map((k) => k.slice(7));
  if (cmIds.length) (await ctx.tx.select({ id: employees.id, n: employees.fullName }).from(employees).where(inArray(employees.id, cmIds))).forEach((e) => names.set(`cm:${e.id}`, e.n));
  if (clientIds.length) (await ctx.tx.select({ id: clients.id, n: clients.tradeName }).from(clients).where(inArray(clients.id, clientIds))).forEach((c) => names.set(`client:${c.id}`, c.n));
  names.set("cm:sin_asignar", "Sin asignar");
  for (const n of SOCIAL_NETWORKS) names.set(`network:${n.value}`, n.label);
  return names;
}

/** Cierra un día: guarda el resultado inmutable. Idempotente (un cierre por día y alcance). */
export async function closePublicationDay(ctx: Ctx, date: string) {
  if (date >= ctx.today) throw conflict("Solo se pueden cerrar días anteriores a hoy");
  const rows = await ctx.tx.select().from(publications).where(eq(publications.scheduledDate, date));
  const scopes = groupAggregates(rows);
  const inserted = await ctx.tx
    .insert(dailyPublicationSnapshots)
    .values([...scopes.entries()].map(([scope, a]) => ({ day: date, scope, ...a })))
    .onConflictDoNothing()
    .returning({ id: dailyPublicationSnapshots.id });
  return inserted.length;
}

/** Historial de cumplimiento por día, semana o mes (a partir de los cierres diarios + hoy en vivo). */
export async function complianceHistory(ctx: Ctx, f: { from: string; to: string; groupBy?: "day" | "week" | "month"; scope?: string }) {
  requirePerm(ctx, "publications.read");
  const scope = f.scope ?? "total";
  const snaps = await ctx.tx
    .select()
    .from(dailyPublicationSnapshots)
    .where(and(gte(dailyPublicationSnapshots.day, f.from), lte(dailyPublicationSnapshots.day, f.to), eq(dailyPublicationSnapshots.scope, scope)))
    .orderBy(asc(dailyPublicationSnapshots.day));
  const days: { day: string; agg: Agg; closed: boolean }[] = snaps.map((s) => ({ day: s.day, agg: s, closed: true }));
  const closedDays = new Set(snaps.map((s) => s.day));
  // Días sin cierre (hoy o días aún no cerrados): cálculo en vivo.
  const openRows = await ctx.tx
    .select()
    .from(publications)
    .where(and(gte(publications.scheduledDate, f.from), lte(publications.scheduledDate, f.to)));
  const liveByDay = new Map<string, typeof openRows>();
  for (const r of openRows) if (!closedDays.has(r.scheduledDate)) liveByDay.set(r.scheduledDate, [...(liveByDay.get(r.scheduledDate) ?? []), r]);
  for (const [day, rows] of liveByDay) {
    const agg = groupAggregates(rows).get(scope);
    if (agg) days.push({ day, agg, closed: false });
  }
  days.sort((a, b) => a.day.localeCompare(b.day));
  const keyOf = (d: string) => (f.groupBy === "month" ? d.slice(0, 7) : f.groupBy === "week" ? startOfWeek(d) : d);
  const groups = new Map<string, Agg & { days: number }>();
  for (const d of days) {
    const k = keyOf(d.day);
    const g = groups.get(k) ?? { planned: 0, published: 0, failed: 0, pending: 0, clientsPlanned: 0, clientsCompliant: 0, days: 0 };
    g.planned += d.agg.planned;
    g.published += d.agg.published;
    g.failed += d.agg.failed;
    g.pending += d.agg.pending;
    g.clientsPlanned += d.agg.clientsPlanned;
    g.clientsCompliant += d.agg.clientsCompliant;
    g.days++;
    groups.set(k, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, days: g.days, ...toCompliance(g) }));
}

/** Contenido de tableros listos (archivos finales) disponible para Community Management. */
export async function contentForCommunity(ctx: Ctx, clientId?: string) {
  requirePerm(ctx, "publications.read");
  const conds = [sql`${productionBoards.readyAt} is not null`, sql`${productionBoards.cancelledAt} is null`, gte(productionBoards.period, addDays(ctx.today, -62).slice(0, 8) + "01")];
  if (clientId) conds.push(eq(productionBoards.clientId, clientId));
  const rows = await ctx.tx
    .select({ d: productionDeliverables, period: productionBoards.period, clientName: clients.tradeName, boardId: productionBoards.id })
    .from(productionDeliverables)
    .innerJoin(productionBoards, eq(productionBoards.id, productionDeliverables.boardId))
    .innerJoin(clients, eq(clients.id, productionDeliverables.clientId))
    .where(and(...conds, notInArray(clients.status, ["archivado", "dado_de_baja"])))
    .orderBy(desc(productionBoards.period), asc(clients.tradeName), asc(productionDeliverables.kind), asc(productionDeliverables.position));
  const scheduled = rows.length
    ? await ctx.tx
        .select({ deliverableId: publications.deliverableId, network: publications.network, status: publications.status, date: publications.scheduledDate })
        .from(publications)
        .where(inArray(publications.deliverableId, rows.map((r) => r.d.id)))
    : [];
  return rows.map((r) => ({ ...r.d, period: r.period, clientName: r.clientName, boardId: r.boardId, publications: scheduled.filter((s) => s.deliverableId === r.d.id) }));
}

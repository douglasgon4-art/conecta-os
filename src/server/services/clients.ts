import { and, asc, desc, eq, gt, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditLogs,
  clientContracts,
  clientOffboardingRecords,
  clients,
  clientStatusHistory,
  clientWorkspaces,
  contentSessions,
  employees,
  invoices,
  monthlyContentPlans,
  productionBoards,
  productionDeliverables,
  publications,
  servicePackages,
  tasks,
} from "../db/schema";
import { audit, can, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, notFound } from "../errors";
import { Loose, parse, zBool, zCurrency, zDate, zEmail, zInt, zMoney, zRequiredDate, zRequiredText, zText, zUuid } from "../validation";
import { normalizeName, phoneDigits } from "@/lib/text";
import { firstOfMonth, formatPeriod } from "@/lib/dates";
import {
  CLIENT_STATUSES,
  COMPLETED_DELIVERABLE_STATUSES,
  OPEN_SESSION_STATUSES,
  OPERATIVE_CLIENT_STATUSES,
  SOCIAL_NETWORKS,
  labelOf,
  values,
  type ClientStatus,
} from "@/lib/domain";
import { getActiveContract, initializeClientWorkspace, type WorkspaceSummary } from "./workspace";
import { notify } from "./notifications";

// ───────────────────────── Validación ─────────────────────────

const socialLinks = z
  .record(z.string(), z.string().trim().max(300))
  .optional()
  .transform((v) => Object.fromEntries(Object.entries(v ?? {}).filter(([, url]) => url)));

export const clientInput = z.object({
  tradeName: zRequiredText(150),
  legalName: zText(200),
  taxId: zText(30),
  contactName: zText(150),
  phone: zText(40),
  email: zEmail(),
  country: z.preprocess((v) => (v === "" || v == null ? "Nicaragua" : v), z.string().max(80)),
  city: zText(80),
  address: zText(300),
  website: zText(300),
  socialLinks,
  accountManagerId: zUuid(),
  communityManagerId: zUuid(),
  notes: zText(4000),
});
export type ClientInput = Loose<typeof clientInput>;

export const contractInput = z.object({
  packageId: zUuid(),
  name: zText(150),
  startDate: zRequiredDate(),
  endDate: zDate(),
  monthlyPrice: zMoney(),
  currency: zCurrency(),
  billingDay: zInt(1, 28).default(5),
  billingFrequencyMonths: zInt(1, 12).default(1),
  sessionsEnabled: zBool().default(true),
  sessionFrequencyMonths: zInt(1, 12).default(1),
  coordinationLeadDays: zInt(0, 60).optional(),
  designsPerMonth: zInt(0, 60).default(6),
  reelsPerMonth: zInt(0, 60).default(6),
  includeProfilePhoto: zBool().default(true),
  includeCover: zBool().default(true),
  includeStrategy: zBool().default(true),
  includeCommunity: zBool().default(true),
  socialNetworks: z.array(z.enum(values(SOCIAL_NETWORKS))).default(["facebook", "instagram"]),
  servicesNotes: zText(2000),
  firstSessionDate: zDate(),
});
export type ContractInput = Loose<typeof contractInput>;

// ───────────────────────── Consultas ─────────────────────────

export async function findClientDuplicates(
  ctx: Ctx,
  data: { tradeName: string; taxId?: string | null; email?: string | null; phone?: string | null },
  excludeId?: string,
) {
  const conds = [eq(clients.normalizedName, normalizeName(data.tradeName))];
  if (data.taxId) conds.push(eq(clients.taxId, data.taxId));
  if (data.email) conds.push(sql`lower(${clients.email}) = lower(${data.email})`);
  const digits = phoneDigits(data.phone);
  if (digits) conds.push(sql`right(regexp_replace(coalesce(${clients.phone}, ''), '\\D', '', 'g'), 8) = ${digits}`);
  const rows = await ctx.tx
    .select({ id: clients.id, tradeName: clients.tradeName, city: clients.city, status: clients.status, phone: clients.phone, email: clients.email })
    .from(clients)
    .where(or(...conds));
  return rows.filter((r) => r.id !== excludeId);
}

export async function listClients(ctx: Ctx, opts: { q?: string; status?: string; scope?: "operativos" | "inactivos" | "todos" } = {}) {
  requirePerm(ctx, "clients.read");
  const conds = [];
  const scope = opts.scope ?? "operativos";
  if (opts.status) conds.push(eq(clients.status, opts.status));
  else if (scope === "operativos") conds.push(inArray(clients.status, [...OPERATIVE_CLIENT_STATUSES, "en_pausa"]));
  else if (scope === "inactivos") conds.push(inArray(clients.status, ["archivado", "dado_de_baja", "prospecto"]));
  if (opts.q) {
    conds.push(or(ilike(clients.tradeName, `%${opts.q}%`), ilike(clients.contactName, `%${opts.q}%`), ilike(clients.city, `%${opts.q}%`)));
  }
  return ctx.tx
    .select({
      id: clients.id,
      tradeName: clients.tradeName,
      contactName: clients.contactName,
      phone: clients.phone,
      city: clients.city,
      status: clients.status,
      serviceStartDate: clients.serviceStartDate,
      accountManager: employees.fullName,
      accountManagerId: clients.accountManagerId,
      monthlyPrice: clientContracts.monthlyPrice,
      currency: clientContracts.currency,
      packageName: clientContracts.name,
    })
    .from(clients)
    .leftJoin(employees, eq(employees.id, clients.accountManagerId))
    .leftJoin(clientContracts, and(eq(clientContracts.clientId, clients.id), eq(clientContracts.status, "vigente")))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(clients.tradeName));
}

export async function searchClients(ctx: Ctx, q: string, limit = 10) {
  requirePerm(ctx, "clients.read");
  const norm = normalizeName(q);
  return ctx.tx
    .select({ id: clients.id, tradeName: clients.tradeName, city: clients.city, status: clients.status })
    .from(clients)
    .where(or(ilike(clients.tradeName, `%${q}%`), ilike(clients.normalizedName, `%${norm}%`), ilike(clients.legalName, `%${q}%`)))
    .orderBy(asc(clients.tradeName))
    .limit(limit);
}

export async function getClient(ctx: Ctx, id: string) {
  requirePerm(ctx, "clients.read");
  const [client] = await ctx.tx
    .select({ client: clients, accountManager: employees.fullName })
    .from(clients)
    .leftJoin(employees, eq(employees.id, clients.accountManagerId))
    .where(eq(clients.id, id));
  if (!client) throw notFound("Cliente");
  const contracts = await ctx.tx.select().from(clientContracts).where(eq(clientContracts.clientId, id)).orderBy(desc(clientContracts.startDate));
  const workspaces = await ctx.tx.select().from(clientWorkspaces).where(eq(clientWorkspaces.clientId, id));
  const statusHistory = await ctx.tx.select().from(clientStatusHistory).where(eq(clientStatusHistory.clientId, id)).orderBy(desc(clientStatusHistory.createdAt));
  const offboarding = await ctx.tx.select().from(clientOffboardingRecords).where(eq(clientOffboardingRecords.clientId, id)).orderBy(desc(clientOffboardingRecords.createdAt));
  return {
    ...client.client,
    accountManager: client.accountManager,
    contract: contracts.find((c) => c.status === "vigente") ?? null,
    contracts,
    workspaces: workspaces.map((w) => w.module),
    statusHistory,
    offboarding,
  };
}

/** Historial de actividad del cliente (auditoría filtrada por cliente). */
export async function clientActivity(ctx: Ctx, clientId: string, limit = 100) {
  requirePerm(ctx, "clients.read");
  // La actividad del cliente es visible para quien puede ver el cliente, aunque no tenga audit.read.
  return ctx.elevate(() =>
    ctx.tx
      .select({ id: auditLogs.id, action: auditLogs.action, summary: auditLogs.summary, source: auditLogs.source, createdAt: auditLogs.createdAt, userId: auditLogs.userId })
      .from(auditLogs)
      .where(eq(auditLogs.clientId, clientId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit),
  );
}

// ───────────────────────── Alta ─────────────────────────

async function recordStatus(ctx: Ctx, clientId: string, from: string | null, to: string, reason?: string | null, effectiveDate?: string) {
  await ctx.tx.insert(clientStatusHistory).values({
    clientId,
    fromStatus: from,
    toStatus: to,
    reason: reason ?? null,
    effectiveDate: effectiveDate ?? ctx.today,
    changedBy: ctx.actor.userId,
  });
}

async function insertContract(ctx: Ctx, clientId: string, c: z.infer<typeof contractInput>) {
  let pkgName: string | null = null;
  if (c.packageId) {
    const [pkg] = await ctx.tx.select().from(servicePackages).where(eq(servicePackages.id, c.packageId));
    if (!pkg) throw notFound("Paquete");
    pkgName = pkg.name;
  }
  if (c.endDate && c.endDate < c.startDate) throw new AppError("VALIDATION", "La fecha de fin del contrato es anterior al inicio");
  const { getSettings } = await import("./settings");
  const settings = await getSettings(ctx);
  const [contract] = await ctx.tx
    .insert(clientContracts)
    .values({
      clientId,
      packageId: c.packageId ?? null,
      name: c.name ?? pkgName ?? "Paquete personalizado",
      startDate: c.startDate,
      endDate: c.endDate ?? null,
      monthlyPrice: c.monthlyPrice,
      currency: c.currency,
      billingDay: c.billingDay,
      billingFrequencyMonths: c.billingFrequencyMonths,
      sessionsEnabled: c.sessionsEnabled,
      sessionFrequencyMonths: c.sessionFrequencyMonths,
      coordinationLeadDays: c.coordinationLeadDays ?? settings.default_coordination_lead_days,
      designsPerMonth: c.designsPerMonth,
      reelsPerMonth: c.reelsPerMonth,
      includeProfilePhoto: c.includeProfilePhoto,
      includeCover: c.includeCover,
      includeStrategy: c.includeStrategy,
      includeCommunity: c.includeCommunity,
      socialNetworks: c.includeCommunity ? c.socialNetworks : [],
      servicesNotes: c.servicesNotes ?? null,
      createdBy: ctx.actor.userId,
    })
    .returning();
  return contract;
}

export type CreateClientResult = { client: typeof clients.$inferSelect; contract: typeof clientContracts.$inferSelect; workspace: WorkspaceSummary };

/**
 * Crea el cliente central con su contrato e inicializa automáticamente todos sus espacios.
 * Todo ocurre en la misma transacción: si algo falla, no queda nada a medias.
 */
export async function createClient(
  ctx: Ctx,
  raw: { client: ClientInput; contract: ContractInput; leadId?: string | null; status?: ClientStatus },
  opts: { allowDuplicate?: boolean } = {},
): Promise<CreateClientResult> {
  requirePerm(ctx, "clients.write", "leads.convert");
  const data = parse(clientInput, raw.client);
  const c = parse(contractInput, raw.contract);

  if (!opts.allowDuplicate) {
    const dups = await findClientDuplicates(ctx, data);
    if (dups.length) {
      throw new AppError("DUPLICATE", `Posible cliente duplicado: ${dups.map((d) => d.tradeName).join(", ")}`, { candidates: dups });
    }
  }

  const status = raw.status ?? "en_incorporacion";
  const [client] = await ctx.tx
    .insert(clients)
    .values({
      ...data,
      legalName: data.legalName ?? null,
      taxId: data.taxId ?? null,
      normalizedName: normalizeName(data.tradeName),
      status,
      serviceStartDate: c.startDate,
      serviceEndDate: c.endDate ?? null,
      leadId: raw.leadId ?? null,
      createdBy: ctx.actor.userId,
    })
    .returning();
  await recordStatus(ctx, client.id, null, status, "Alta de cliente");
  const contract = await insertContract(ctx, client.id, c);
  const workspace = await initializeClientWorkspace(ctx, client.id, { firstSessionDate: c.firstSessionDate });

  await audit(ctx, {
    action: "client.create",
    entityType: "client",
    entityId: client.id,
    clientId: client.id,
    summary: `Cliente creado: ${client.tradeName} (${contract.name}). Espacios: ${workspace.modules.join(", ")}`,
    after: { client, contract, workspace },
  });
  await notify(ctx, {
    type: "client_onboarding",
    title: `Nuevo cliente: ${client.tradeName}`,
    body: `Se generaron ${workspace.onboardingTasks} tareas de incorporación, ${workspace.boards} tablero(s) y ${workspace.invoices} cuenta(s) por cobrar.`,
    link: `/clientes/${client.id}`,
    entityType: "client",
    entityId: client.id,
    dedupeKey: `client_created:${client.id}`,
    employeeIds: [client.accountManagerId],
  });
  return { client, contract, workspace };
}

export async function updateClient(ctx: Ctx, id: string, raw: Partial<ClientInput>) {
  requirePerm(ctx, "clients.write");
  const data = parse(clientInput.partial(), raw);
  const [before] = await ctx.tx.select().from(clients).where(eq(clients.id, id));
  if (!before) throw notFound("Cliente");
  const patch: Partial<typeof clients.$inferInsert> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined && k in raw) (patch as Record<string, unknown>)[k] = v;
  if (data.tradeName) {
    patch.normalizedName = normalizeName(data.tradeName);
    const dups = await findClientDuplicates(ctx, { tradeName: data.tradeName }, id);
    if (dups.length) throw new AppError("DUPLICATE", `Ya existe un cliente con ese nombre: ${dups[0].tradeName}`, { candidates: dups });
  }
  const [after] = await ctx.tx.update(clients).set(patch).where(eq(clients.id, id)).returning();
  await audit(ctx, { action: "client.update", entityType: "client", entityId: id, clientId: id, summary: `Ficha actualizada: ${after.tradeName}`, before, after });
  return after;
}

/** Modifica el contrato vigente. Los períodos ya generados no se borran; los nuevos usan los valores actualizados. */
export async function updateContract(ctx: Ctx, clientId: string, raw: Partial<ContractInput>) {
  requirePerm(ctx, "clients.write");
  const data = parse(contractInput.partial(), raw);
  const before = await getActiveContract(ctx, clientId);
  if (!before) throw notFound("Contrato vigente");
  const patch: Partial<typeof clientContracts.$inferInsert> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined && k in raw && k !== "firstSessionDate") (patch as Record<string, unknown>)[k] = v;
  const [after] = await ctx.tx.update(clientContracts).set(patch).where(eq(clientContracts.id, before.id)).returning();
  await initializeClientWorkspace(ctx, clientId, { onboarding: false });
  await audit(ctx, { action: "contract.update", entityType: "contract", entityId: after.id, clientId, summary: `Contrato actualizado: ${after.name}`, before, after });
  return after;
}

// ───────────────────────── Ciclo de vida ─────────────────────────

async function loadClient(ctx: Ctx, id: string) {
  const [c] = await ctx.tx.select().from(clients).where(eq(clients.id, id));
  if (!c) throw notFound("Cliente");
  return c;
}

export async function setClientStatus(ctx: Ctx, id: string, to: "activo" | "en_pausa", reason?: string) {
  requirePerm(ctx, "clients.write");
  const c = await loadClient(ctx, id);
  const allowed: Record<string, string[]> = { activo: ["en_incorporacion", "en_pausa"], en_pausa: ["activo", "en_incorporacion"] };
  if (!allowed[to].includes(c.status)) {
    throw conflict(`No se puede pasar de "${labelOf(CLIENT_STATUSES, c.status)}" a "${labelOf(CLIENT_STATUSES, to)}"`);
  }
  const [after] = await ctx.tx.update(clients).set({ status: to }).where(eq(clients.id, id)).returning();
  await recordStatus(ctx, id, c.status, to, reason);
  if (to === "activo") await initializeClientWorkspace(ctx, id, { onboarding: false });
  await audit(ctx, { action: `client.status`, entityType: "client", entityId: id, clientId: id, summary: `${c.tradeName}: ${labelOf(CLIENT_STATUSES, c.status)} → ${labelOf(CLIENT_STATUSES, to)}`, before: c, after });
  return after;
}

type ClosureStats = { boardsCancelled: number; plansCancelled: number; tasksCancelled: number; publicationsVoided: number; sessionsCancelled: number };

/**
 * Detiene la operación futura del cliente sin borrar historial:
 * cancela tableros/planificaciones posteriores al último período, tareas abiertas futuras,
 * publicaciones futuras no realizadas y (según la decisión) sesiones futuras.
 */
async function stopFutureOperations(
  ctx: Ctx,
  clientId: string,
  o: { afterDate: string; lastServicePeriod: string; reason: string; cancelSessions: boolean; allTasks: boolean },
): Promise<ClosureStats> {
  const now = new Date();
  const boards = await ctx.tx
    .update(productionBoards)
    .set({ cancelledAt: now, cancelReason: o.reason })
    .where(and(eq(productionBoards.clientId, clientId), gt(productionBoards.period, o.lastServicePeriod), isNull(productionBoards.cancelledAt)))
    .returning({ id: productionBoards.id });
  const plans = await ctx.tx
    .update(monthlyContentPlans)
    .set({ cancelledAt: now, cancelReason: o.reason })
    .where(and(eq(monthlyContentPlans.clientId, clientId), gt(monthlyContentPlans.period, o.lastServicePeriod), isNull(monthlyContentPlans.cancelledAt)))
    .returning({ id: monthlyContentPlans.id });
  const taskConds = [eq(tasks.clientId, clientId), inArray(tasks.status, ["pendiente", "en_progreso"])];
  if (!o.allTasks) taskConds.push(or(isNull(tasks.dueDate), gt(tasks.dueDate, o.afterDate))!);
  const cancelledTasks = await ctx.tx
    .update(tasks)
    .set({ status: "cancelada", cancelReason: o.reason })
    .where(and(...taskConds))
    .returning({ id: tasks.id });
  const pubs = await ctx.tx
    .update(publications)
    .set({ status: "no_aplica", notes: sql`concat_ws(' · ', ${publications.notes}, ${o.reason}::text)` })
    .where(
      and(
        eq(publications.clientId, clientId),
        gt(publications.scheduledDate, o.afterDate),
        notInArray(publications.status, ["publicada", "fallida", "reprogramada", "no_aplica"]),
      ),
    )
    .returning({ id: publications.id });
  let sessionsCancelled = 0;
  if (o.cancelSessions) {
    const s = await ctx.tx
      .update(contentSessions)
      .set({ status: "cancelada", notes: sql`concat_ws(' · ', ${contentSessions.notes}, ${o.reason}::text)` })
      .where(
        and(
          eq(contentSessions.clientId, clientId),
          inArray(contentSessions.status, OPEN_SESSION_STATUSES),
          sql`coalesce(${contentSessions.confirmedDate}, ${contentSessions.proposedDate}, ${contentSessions.expectedDate}) > ${o.afterDate}`,
        ),
      )
      .returning({ id: contentSessions.id });
    sessionsCancelled = s.length;
  }
  return { boardsCancelled: boards.length, plansCancelled: plans.length, tasksCancelled: cancelledTasks.length, publicationsVoided: pubs.length, sessionsCancelled };
}

export async function archiveClient(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "clients.archive");
  if (!reason?.trim()) throw new AppError("VALIDATION", "Indica el motivo del archivo");
  const c = await loadClient(ctx, id);
  if (c.status === "archivado") throw conflict("El cliente ya está archivado");
  const curPeriod = firstOfMonth(ctx.today);
  const stats = await stopFutureOperations(ctx, id, {
    afterDate: ctx.today,
    lastServicePeriod: curPeriod,
    reason: `Cliente archivado: ${reason}`,
    cancelSessions: true,
    allTasks: true,
  });
  await ctx.tx
    .update(clientContracts)
    .set({ status: "finalizado", endDate: ctx.today })
    .where(and(eq(clientContracts.clientId, id), eq(clientContracts.status, "vigente")));
  const [after] = await ctx.tx
    .update(clients)
    .set({ status: "archivado", archivedAt: new Date(), archivedBy: ctx.actor.userId, archiveReason: reason, serviceEndDate: ctx.today })
    .where(eq(clients.id, id))
    .returning();
  await recordStatus(ctx, id, c.status, "archivado", reason);
  await audit(ctx, { action: "client.archive", entityType: "client", entityId: id, clientId: id, summary: `Cliente archivado: ${c.tradeName}. Motivo: ${reason}`, before: c, after: { ...after, stats } });
  await notify(ctx, {
    type: "client_lifecycle",
    title: `Cliente archivado: ${c.tradeName}`,
    body: reason,
    link: `/clientes/${id}`,
    entityType: "client",
    entityId: id,
    dedupeKey: `client_archived:${id}:${ctx.today}`,
  });
  return { client: after, stats };
}

export const offboardingInput = z.object({
  effectiveDate: zRequiredDate(),
  reason: zRequiredText(500),
  lastServicePeriod: zRequiredDate(),
  responsibleId: zUuid(),
  notes: zText(2000),
  futureSessionsDecision: z.enum(["cancelar", "conservar"]).default("cancelar"),
});

/** Resumen de obligaciones pendientes que se muestra antes de confirmar una baja. */
export async function offboardingPreview(ctx: Ctx, id: string, lastServicePeriod?: string) {
  requirePerm(ctx, "clients.archive");
  const c = await loadClient(ctx, id);
  const lastP = firstOfMonth(lastServicePeriod ?? ctx.today);
  return ctx.elevate(async () => {
    const pendingInvoices = await ctx.tx
      .select({ id: invoices.id, number: invoices.number, amount: invoices.amount, paidAmount: invoices.paidAmount, currency: invoices.currency, dueDate: invoices.dueDate })
      .from(invoices)
      .where(and(eq(invoices.clientId, id), inArray(invoices.status, ["pendiente", "parcial"])));
    const openDeliverables = await ctx.tx
      .select({ period: productionBoards.period, n: sql<number>`count(*)::int` })
      .from(productionDeliverables)
      .innerJoin(productionBoards, eq(productionBoards.id, productionDeliverables.boardId))
      .where(
        and(
          eq(productionBoards.clientId, id),
          isNull(productionBoards.cancelledAt),
          sql`${productionBoards.period} <= ${lastP}`,
          notInArray(productionDeliverables.status, [...COMPLETED_DELIVERABLE_STATUSES]),
        ),
      )
      .groupBy(productionBoards.period);
    const openSessions = await ctx.tx
      .select({ id: contentSessions.id, expectedDate: contentSessions.expectedDate, confirmedDate: contentSessions.confirmedDate, status: contentSessions.status })
      .from(contentSessions)
      .where(and(eq(contentSessions.clientId, id), inArray(contentSessions.status, OPEN_SESSION_STATUSES)));
    const futureBoards = await ctx.tx
      .select({ id: productionBoards.id, period: productionBoards.period })
      .from(productionBoards)
      .where(and(eq(productionBoards.clientId, id), gt(productionBoards.period, lastP), isNull(productionBoards.cancelledAt)));
    const balance = pendingInvoices.reduce<Record<string, number>>((acc, i) => {
      acc[i.currency] = (acc[i.currency] ?? 0) + (i.amount - i.paidAmount);
      return acc;
    }, {});
    return {
      client: { id: c.id, tradeName: c.tradeName, status: c.status },
      pendingInvoices,
      balance,
      openDeliverables: openDeliverables.map((d) => ({ period: d.period, label: formatPeriod(d.period), open: d.n })),
      openSessions,
      futureBoards,
    };
  });
}

/** Baja formal: conserva facturas, pagos, deudas, documentos e historial. */
export async function offboardClient(ctx: Ctx, id: string, raw: Loose<typeof offboardingInput>) {
  requirePerm(ctx, "clients.archive");
  const input = parse(offboardingInput, raw);
  const c = await loadClient(ctx, id);
  if (["dado_de_baja", "archivado"].includes(c.status)) throw conflict(`El cliente está ${labelOf(CLIENT_STATUSES, c.status).toLowerCase()}`);
  const lastP = firstOfMonth(input.lastServicePeriod);
  if (lastP > firstOfMonth(input.effectiveDate)) throw new AppError("VALIDATION", "El último período de servicio no puede ser posterior a la fecha efectiva");
  const preview = await offboardingPreview(ctx, id, lastP);
  const stats = await stopFutureOperations(ctx, id, {
    afterDate: input.effectiveDate,
    lastServicePeriod: lastP,
    reason: `Baja del cliente: ${input.reason}`,
    cancelSessions: input.futureSessionsDecision === "cancelar",
    allTasks: false,
  });
  const immediate = input.effectiveDate <= ctx.today;
  const to: ClientStatus = immediate ? "dado_de_baja" : "en_proceso_baja";
  await ctx.tx
    .update(clientContracts)
    .set({ endDate: input.effectiveDate, ...(immediate ? { status: "finalizado" } : {}) })
    .where(and(eq(clientContracts.clientId, id), eq(clientContracts.status, "vigente")));
  const [record] = await ctx.tx
    .insert(clientOffboardingRecords)
    .values({
      clientId: id,
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      lastServicePeriod: lastP,
      responsibleId: input.responsibleId ?? null,
      notes: input.notes ?? null,
      futureSessionsDecision: input.futureSessionsDecision,
      pendingSummary: { ...preview, stats } as never,
      completedAt: immediate ? new Date() : null,
      createdBy: ctx.actor.userId,
    })
    .returning();
  const [after] = await ctx.tx.update(clients).set({ status: to, serviceEndDate: input.effectiveDate }).where(eq(clients.id, id)).returning();
  await recordStatus(ctx, id, c.status, to, input.reason, input.effectiveDate);
  await audit(ctx, {
    action: "client.offboard",
    entityType: "client",
    entityId: id,
    clientId: id,
    summary: `Baja de ${c.tradeName} efectiva el ${input.effectiveDate}. Motivo: ${input.reason}`,
    before: c,
    after: { client: after, record, stats },
  });
  await notify(ctx, {
    type: "client_lifecycle",
    title: `Baja de cliente: ${c.tradeName}`,
    body: `Efectiva el ${input.effectiveDate}. Saldo pendiente: ${Object.entries(preview.balance).map(([cur, v]) => `${v} ${cur}`).join(", ") || "ninguno"}`,
    link: `/clientes/${id}`,
    entityType: "client",
    entityId: id,
    dedupeKey: `client_offboard:${record.id}`,
  });
  return { client: after, record, preview, stats };
}

/** Completa las bajas programadas cuya fecha efectiva ya llegó (lo ejecuta la automatización diaria). */
export async function completeDueOffboardings(ctx: Ctx) {
  const due = await ctx.tx
    .select({ client: clients, record: clientOffboardingRecords })
    .from(clients)
    .innerJoin(clientOffboardingRecords, and(eq(clientOffboardingRecords.clientId, clients.id), isNull(clientOffboardingRecords.completedAt)))
    .where(and(eq(clients.status, "en_proceso_baja"), sql`${clientOffboardingRecords.effectiveDate} <= ${ctx.today}`));
  for (const { client, record } of due) {
    await ctx.tx.update(clientContracts).set({ status: "finalizado" }).where(and(eq(clientContracts.clientId, client.id), eq(clientContracts.status, "vigente")));
    await ctx.tx.update(clients).set({ status: "dado_de_baja" }).where(eq(clients.id, client.id));
    await ctx.tx.update(clientOffboardingRecords).set({ completedAt: new Date() }).where(eq(clientOffboardingRecords.id, record.id));
    await recordStatus(ctx, client.id, "en_proceso_baja", "dado_de_baja", record.reason, record.effectiveDate);
    await audit(ctx, { action: "client.offboard_complete", entityType: "client", entityId: client.id, clientId: client.id, summary: `Baja completada: ${client.tradeName}` });
  }
  return due.length;
}

/** Reactiva un cliente archivado o dado de baja con un contrato nuevo confirmado. */
export async function reactivateClient(ctx: Ctx, id: string, rawContract: ContractInput, reason?: string) {
  requirePerm(ctx, "clients.archive");
  const c = await loadClient(ctx, id);
  if (!["archivado", "dado_de_baja", "en_pausa"].includes(c.status)) {
    throw conflict(`Solo se reactivan clientes archivados, dados de baja o en pausa (estado actual: ${labelOf(CLIENT_STATUSES, c.status)})`);
  }
  const contractData = parse(contractInput, rawContract);
  if (c.status === "en_pausa") return { client: await setClientStatus(ctx, id, "activo", reason), workspace: null };

  const existing = await getActiveContract(ctx, id);
  if (existing) await ctx.tx.update(clientContracts).set({ status: "finalizado", endDate: ctx.today }).where(eq(clientContracts.id, existing.id));
  const contract = await insertContract(ctx, id, contractData);

  // Reabrir tableros/planificaciones de períodos del nuevo contrato que se hubieran cancelado al cerrar.
  const fromP = firstOfMonth(contract.startDate);
  await ctx.tx
    .update(productionBoards)
    .set({ cancelledAt: null, cancelReason: null, contractId: contract.id })
    .where(and(eq(productionBoards.clientId, id), sql`${productionBoards.period} >= ${fromP}`));
  await ctx.tx
    .update(monthlyContentPlans)
    .set({ cancelledAt: null, cancelReason: null, contractId: contract.id })
    .where(and(eq(monthlyContentPlans.clientId, id), sql`${monthlyContentPlans.period} >= ${fromP}`));

  const [after] = await ctx.tx
    .update(clients)
    .set({ status: "activo", archivedAt: null, archivedBy: null, archiveReason: null, serviceStartDate: contract.startDate, serviceEndDate: contract.endDate })
    .where(eq(clients.id, id))
    .returning();
  await recordStatus(ctx, id, c.status, "activo", reason ?? "Reactivación");
  const workspace = await initializeClientWorkspace(ctx, id, { firstSessionDate: contractData.firstSessionDate });
  await audit(ctx, {
    action: "client.reactivate",
    entityType: "client",
    entityId: id,
    clientId: id,
    summary: `Cliente reactivado: ${c.tradeName} con contrato "${contract.name}" desde ${contract.startDate}`,
    before: c,
    after: { client: after, contract, workspace },
  });
  await notify(ctx, {
    type: "client_lifecycle",
    title: `Cliente reactivado: ${c.tradeName}`,
    link: `/clientes/${id}`,
    entityType: "client",
    entityId: id,
    dedupeKey: `client_reactivated:${contract.id}`,
  });
  return { client: after, contract, workspace };
}

export async function listPackages(ctx: Ctx) {
  return ctx.tx.select().from(servicePackages).where(eq(servicePackages.isActive, true)).orderBy(asc(servicePackages.name));
}

export function canSeeFinance(ctx: Ctx) {
  return can(ctx, "finance.read");
}


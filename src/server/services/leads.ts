import { and, asc, desc, eq, ilike, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, employees, leadCalls, leads, salesProposals } from "../db/schema";
import { audit, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, notFound } from "../errors";
import { Loose, parse, zCurrency, zDate, zEmail, zMoney, zRequiredText, zText, zUuid } from "../validation";
import { normalizeName, phoneDigits } from "@/lib/text";
import { CALL_RESULTS, CLOSED_LEAD_STATUSES, INTEREST_LEVELS, LEAD_STATUSES, labelOf, values, type LeadStatus } from "@/lib/domain";
import { createClient, findClientDuplicates, type ContractInput } from "./clients";
import { initializeClientWorkspace, getActiveContract } from "./workspace";
import { notify } from "./notifications";

export const leadInput = z.object({
  tradeName: zRequiredText(150),
  contactName: zText(150),
  phone: zText(40),
  email: zEmail(),
  country: z.preprocess((v) => (v === "" || v == null ? "Nicaragua" : v), z.string().max(80)),
  city: zText(80),
  address: zText(300),
  businessType: zText(100),
  website: zText(300),
  socialLinks: z.record(z.string(), z.string()).optional(),
  source: zText(100),
  ownerId: zUuid(),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(LEAD_STATUSES)).optional()),
  nextFollowupAt: zDate(),
  nextAction: zText(300),
  notes: zText(4000),
});
export type LeadInput = Loose<typeof leadInput>;

/** Listas de trabajo dinámicas: se calculan desde el estado, nunca se mantienen a mano. */
export const LEAD_LISTS: Record<string, { label: string; statuses?: LeadStatus[]; dueOnly?: boolean }> = {
  hoy: { label: "Seguimientos para hoy", dueOnly: true },
  pendientes: { label: "Pendientes de contactar", statuses: ["pendiente_contactar"] },
  volver: { label: "Volver a llamar / no contestó", statuses: ["no_contesto", "volver_a_llamar"] },
  interesados: { label: "Interesados y reuniones", statuses: ["primer_contacto", "interesado", "reunion_programada"] },
  propuestas: { label: "Propuestas y negociación", statuses: ["propuesta_enviada", "en_negociacion", "seguimiento_pendiente"] },
  proximo_mes: { label: "Seguimiento el próximo mes", statuses: ["seguimiento_proximo_mes"] },
  ganadas: { label: "Ventas ganadas", statuses: ["venta_ganada"] },
  cerrados: { label: "No interesados / perdidos", statuses: ["no_interesado", "no_necesita", "venta_perdida"] },
};

export async function findLeadDuplicates(ctx: Ctx, data: { tradeName: string; phone?: string | null; email?: string | null }, excludeId?: string) {
  const conds = [eq(leads.normalizedName, normalizeName(data.tradeName))];
  const digits = phoneDigits(data.phone);
  if (digits) conds.push(eq(leads.phoneDigits, digits));
  if (data.email) conds.push(sql`lower(${leads.email}) = lower(${data.email})`);
  const rows = await ctx.tx.select({ id: leads.id, tradeName: leads.tradeName, status: leads.status, city: leads.city, phone: leads.phone }).from(leads).where(or(...conds));
  return rows.filter((r) => r.id !== excludeId);
}

export async function createLead(ctx: Ctx, raw: LeadInput, opts: { allowDuplicate?: boolean } = {}) {
  requirePerm(ctx, "leads.write");
  const input = parse(leadInput, raw);
  if (!opts.allowDuplicate) {
    const dups = await findLeadDuplicates(ctx, input);
    if (dups.length) throw new AppError("DUPLICATE", `Ya existe un prospecto que coincide: ${dups.map((d) => `${d.tradeName} (${labelOf(LEAD_STATUSES, d.status)})`).join(", ")}`, { candidates: dups });
    const clientDups = await findClientDuplicates(ctx, { tradeName: input.tradeName, phone: input.phone, email: input.email });
    if (clientDups.length) throw new AppError("DUPLICATE", `Ese negocio ya es (o fue) cliente: ${clientDups.map((c) => c.tradeName).join(", ")}`, { clientCandidates: clientDups });
  }
  const [lead] = await ctx.tx
    .insert(leads)
    .values({
      ...input,
      socialLinks: input.socialLinks ?? {},
      normalizedName: normalizeName(input.tradeName),
      phoneDigits: phoneDigits(input.phone),
      status: input.status ?? "pendiente_contactar",
      ownerId: input.ownerId ?? ctx.actor.employeeId ?? null,
      createdBy: ctx.actor.userId,
    })
    .returning();
  await audit(ctx, { action: "lead.create", entityType: "lead", entityId: lead.id, summary: `Prospecto creado: ${lead.tradeName} (${labelOf(LEAD_STATUSES, lead.status)})`, after: lead });
  return lead;
}

export async function updateLead(ctx: Ctx, id: string, raw: Partial<LeadInput>) {
  requirePerm(ctx, "leads.write");
  const input = parse(leadInput.partial(), raw);
  const [before] = await ctx.tx.select().from(leads).where(eq(leads.id, id));
  if (!before) throw notFound("Prospecto");
  if (input.status === "venta_ganada") throw new AppError("VALIDATION", "Para marcar la venta como ganada usa «Convertir en cliente»");
  const patch: Partial<typeof leads.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (k in raw) (patch as Record<string, unknown>)[k] = v ?? null;
  if (input.tradeName) patch.normalizedName = normalizeName(input.tradeName);
  if ("phone" in raw) patch.phoneDigits = phoneDigits(input.phone);
  if (patch.status === null) delete patch.status;
  const [after] = await ctx.tx.update(leads).set(patch).where(eq(leads.id, id)).returning();
  await audit(ctx, { action: "lead.update", entityType: "lead", entityId: id, summary: `Prospecto actualizado: ${after.tradeName}${before.status !== after.status ? ` (${labelOf(LEAD_STATUSES, before.status)} → ${labelOf(LEAD_STATUSES, after.status)})` : ""}`, before, after });
  return after;
}

export async function listLeads(ctx: Ctx, f: { list?: string; q?: string; ownerId?: string } = {}) {
  requirePerm(ctx, "leads.read");
  const conds = [];
  const def = f.list ? LEAD_LISTS[f.list] : undefined;
  if (def?.statuses) conds.push(inArray(leads.status, def.statuses));
  if (def?.dueOnly) conds.push(lte(leads.nextFollowupAt, ctx.today), notInArray(leads.status, CLOSED_LEAD_STATUSES));
  if (f.ownerId) conds.push(eq(leads.ownerId, f.ownerId));
  if (f.q) conds.push(or(ilike(leads.tradeName, `%${f.q}%`), ilike(leads.contactName, `%${f.q}%`), ilike(leads.city, `%${f.q}%`), ilike(leads.phone, `%${f.q}%`)));
  return ctx.tx
    .select({ lead: leads, owner: employees.fullName })
    .from(leads)
    .leftJoin(employees, eq(employees.id, leads.ownerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${leads.nextFollowupAt} asc nulls last`, asc(leads.tradeName));
}

export async function leadListCounts(ctx: Ctx) {
  requirePerm(ctx, "leads.read");
  const rows = await ctx.tx.select({ status: leads.status, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.status);
  const [due] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(lte(leads.nextFollowupAt, ctx.today), notInArray(leads.status, CLOSED_LEAD_STATUSES)));
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return Object.fromEntries(
    Object.entries(LEAD_LISTS).map(([key, def]) => [key, def.dueOnly ? due.n : (def.statuses ?? []).reduce((a, s) => a + (byStatus[s] ?? 0), 0)]),
  );
}

export async function getLead(ctx: Ctx, id: string) {
  requirePerm(ctx, "leads.read");
  const [row] = await ctx.tx.select({ lead: leads, owner: employees.fullName }).from(leads).leftJoin(employees, eq(employees.id, leads.ownerId)).where(eq(leads.id, id));
  if (!row) throw notFound("Prospecto");
  const calls = await ctx.tx.select({ call: leadCalls, agent: employees.fullName }).from(leadCalls).leftJoin(employees, eq(employees.id, leadCalls.agentId)).where(eq(leadCalls.leadId, id)).orderBy(desc(leadCalls.calledAt));
  const proposals = await ctx.tx.select().from(salesProposals).where(eq(salesProposals.leadId, id)).orderBy(desc(salesProposals.createdAt));
  const client = row.lead.clientId ? (await ctx.tx.select({ id: clients.id, tradeName: clients.tradeName, status: clients.status }).from(clients).where(eq(clients.id, row.lead.clientId)))[0] : null;
  return { ...row.lead, owner: row.owner, calls: calls.map((c) => ({ ...c.call, agent: c.agent })), proposals, client };
}

export const callInput = z.object({
  calledAt: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional()),
  channel: z.enum(["llamada", "whatsapp", "reunion", "correo", "visita"]).default("llamada"),
  result: z.enum(values(CALL_RESULTS)),
  answeredBy: zText(150),
  response: zText(2000),
  interestLevel: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(INTEREST_LEVELS)).optional()),
  objections: zText(2000),
  notes: zText(4000),
  nextAction: zText(300),
  nextFollowupAt: zDate(),
  statusAfter: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(LEAD_STATUSES)).optional()),
});

/** Registra una llamada; conserva el historial y actualiza el estado y el próximo seguimiento del prospecto. */
export async function logCall(ctx: Ctx, leadId: string, raw: Loose<typeof callInput>) {
  requirePerm(ctx, "leads.write");
  const input = parse(callInput, raw);
  const [lead] = await ctx.tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead) throw notFound("Prospecto");
  if (input.statusAfter === "venta_ganada") throw new AppError("VALIDATION", "Para marcar la venta como ganada usa «Convertir en cliente»");
  const autoStatus: Partial<Record<string, LeadStatus>> = { no_contesto: "no_contesto", buzon: "no_contesto", contesto: lead.status === "pendiente_contactar" ? "primer_contacto" : undefined };
  const statusAfter = input.statusAfter ?? autoStatus[input.result] ?? (lead.status as LeadStatus);
  const calledAt = input.calledAt ?? ctx.now;
  const [call] = await ctx.tx
    .insert(leadCalls)
    .values({
      leadId,
      calledAt,
      channel: input.channel,
      agentId: ctx.actor.employeeId,
      result: input.result,
      answeredBy: input.answeredBy ?? null,
      response: input.response ?? null,
      interestLevel: input.interestLevel ?? null,
      objections: input.objections ?? null,
      notes: input.notes ?? null,
      nextAction: input.nextAction ?? null,
      nextFollowupAt: input.nextFollowupAt ?? null,
      statusAfter,
      createdBy: ctx.actor.userId,
    })
    .returning();
  const [after] = await ctx.tx
    .update(leads)
    .set({ status: statusAfter, lastContactAt: calledAt, nextFollowupAt: input.nextFollowupAt ?? null, nextAction: input.nextAction ?? null })
    .where(eq(leads.id, leadId))
    .returning();
  await audit(ctx, { action: "lead.call", entityType: "lead", entityId: leadId, summary: `${labelOf(CALL_RESULTS, input.result)} con ${lead.tradeName} → ${labelOf(LEAD_STATUSES, statusAfter)}`, after: call });
  return { call, lead: after };
}

export const proposalInput = z.object({
  title: zRequiredText(200),
  packageId: zUuid(),
  monthlyPrice: zMoney(),
  currency: zCurrency(),
  sentAt: zDate(),
  notes: zText(2000),
});

export async function createProposal(ctx: Ctx, leadId: string, raw: Loose<typeof proposalInput>) {
  requirePerm(ctx, "leads.write");
  const input = parse(proposalInput, raw);
  const [lead] = await ctx.tx.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw notFound("Prospecto");
  const [p] = await ctx.tx
    .insert(salesProposals)
    .values({ leadId, ...input, packageId: input.packageId ?? null, sentAt: input.sentAt ?? null, notes: input.notes ?? null, status: input.sentAt ? "enviada" : "borrador", createdBy: ctx.actor.userId })
    .returning();
  if (input.sentAt && !CLOSED_LEAD_STATUSES.includes(lead.status as LeadStatus)) {
    await ctx.tx.update(leads).set({ status: "propuesta_enviada" }).where(eq(leads.id, leadId));
  }
  await audit(ctx, { action: "lead.proposal", entityType: "lead", entityId: leadId, summary: `Propuesta "${p.title}" para ${lead.tradeName}: ${p.monthlyPrice} ${p.currency}` });
  return p;
}

export async function loseLead(ctx: Ctx, id: string, status: "venta_perdida" | "no_interesado" | "no_necesita", reason?: string) {
  requirePerm(ctx, "leads.write");
  const [lead] = await ctx.tx.select().from(leads).where(eq(leads.id, id));
  if (!lead) throw notFound("Prospecto");
  if (lead.status === "venta_ganada") throw conflict("La venta ya fue ganada y convertida en cliente");
  return updateLead(ctx, id, { status, nextFollowupAt: "", nextAction: "", ...(reason ? { notes: [lead.notes, `Motivo: ${reason}`].filter(Boolean).join("\n") } : {}) }).then(async (r) => {
    await ctx.tx.update(leads).set({ lostReason: reason ?? null }).where(eq(leads.id, id));
    return r;
  });
}

/**
 * Venta ganada → cliente. En una sola transacción:
 * crea (o vincula, sin duplicar) el cliente central, registra el contrato, genera los espacios,
 * tareas de incorporación y la cuenta por cobrar (nunca pagada), y avisa a Administración y Gerencia.
 */
export async function convertLead(
  ctx: Ctx,
  leadId: string,
  input: { contract: ContractInput; linkClientId?: string; allowDuplicate?: boolean; client?: { accountManagerId?: string; communityManagerId?: string; legalName?: string; taxId?: string } },
) {
  requirePerm(ctx, "leads.convert");
  const [lead] = await ctx.tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead) throw notFound("Prospecto");
  if (lead.status === "venta_ganada" && lead.clientId) throw conflict("Este prospecto ya fue convertido en cliente", { clientId: lead.clientId });

  let clientId: string;
  let created = false;
  let workspace;
  if (input.linkClientId) {
    const [existing] = await ctx.tx.select().from(clients).where(eq(clients.id, input.linkClientId));
    if (!existing) throw notFound("Cliente a vincular");
    clientId = existing.id;
    const result = await ctx.elevate(async () => {
      const active = await getActiveContract(ctx, clientId);
      if (active) return { workspace: await initializeClientWorkspace(ctx, clientId), reactivated: false };
      const { reactivateClient } = await import("./clients");
      if (["archivado", "dado_de_baja", "en_pausa"].includes(existing.status)) {
        const r = await reactivateClient(ctx, clientId, input.contract, `Venta ganada: ${lead.tradeName}`);
        return { workspace: r.workspace, reactivated: true };
      }
      throw conflict(`${existing.tradeName} no tiene contrato vigente; usa su ficha para registrar el contrato`);
    });
    workspace = result.workspace;
  } else {
    const r = await ctx.elevate(() =>
      createClient(
        ctx,
        {
          client: {
            tradeName: lead.tradeName,
            contactName: lead.contactName ?? undefined,
            phone: lead.phone ?? undefined,
            email: lead.email ?? undefined,
            country: lead.country,
            city: lead.city ?? undefined,
            address: lead.address ?? undefined,
            website: lead.website ?? undefined,
            socialLinks: lead.socialLinks,
            notes: lead.notes ?? undefined,
            ...input.client,
          },
          contract: input.contract,
          leadId: lead.id,
        },
        { allowDuplicate: input.allowDuplicate },
      ),
    );
    clientId = r.client.id;
    workspace = r.workspace;
    created = true;
  }

  const [after] = await ctx.tx
    .update(leads)
    .set({ status: "venta_ganada", clientId, convertedAt: new Date(), nextFollowupAt: null, nextAction: null })
    .where(eq(leads.id, leadId))
    .returning();
  await ctx.tx.update(clients).set({ leadId }).where(and(eq(clients.id, clientId), sql`${clients.leadId} is null`));
  await audit(ctx, {
    action: "lead.convert",
    entityType: "lead",
    entityId: leadId,
    clientId,
    summary: `Venta ganada: ${lead.tradeName} → ${created ? "cliente nuevo" : "cliente existente vinculado"}`,
    before: lead,
    after,
  });
  await notify(ctx, {
    type: "client_onboarding",
    severity: "success",
    title: `Venta ganada: ${lead.tradeName}`,
    body: created ? "Cliente creado con sus espacios de trabajo y cuenta por cobrar." : "Venta vinculada a un cliente existente.",
    link: `/clientes/${clientId}`,
    dedupeKey: `lead_won:${leadId}`,
  });
  return { lead: after, clientId, created, workspace };
}

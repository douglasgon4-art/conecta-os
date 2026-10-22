import { and, eq, inArray } from "drizzle-orm";
import { clientContracts, clients, clientWorkspaces, contentSessions, socialAccounts, tasks } from "../db/schema";
import type { Ctx } from "../ctx";
import { addDays, addMonths, firstOfMonth, maxDate, monthsBetween } from "@/lib/dates";
import { OPEN_SESSION_STATUSES, OPERATIVE_CLIENT_STATUSES, type ClientStatus } from "@/lib/domain";
import { getSettings, type Settings } from "./settings";
import { ensurePlan } from "./strategy";
import { ensureBoard } from "./production";
import { ensureContractInvoice } from "./invoices";
import { notFound } from "../errors";

export type Client = typeof clients.$inferSelect;
export type Contract = typeof clientContracts.$inferSelect;

export const contractServices = (c: Contract) => ({
  sessions: c.sessionsEnabled,
  strategy: c.includeStrategy,
  community: c.includeCommunity && c.socialNetworks.length > 0,
  design: c.designsPerMonth > 0 || c.includeProfilePhoto || c.includeCover,
  video: c.reelsPerMonth > 0,
});

export async function getActiveContract(ctx: Ctx, clientId: string): Promise<Contract | null> {
  const [c] = await ctx.tx
    .select()
    .from(clientContracts)
    .where(and(eq(clientContracts.clientId, clientId), eq(clientContracts.status, "vigente")));
  return c ?? null;
}

/**
 * Períodos de servicio a mantener generados: desde el mes actual (o el de inicio, si es futuro)
 * hasta N meses adelante, sin pasar del fin de contrato ni del último período de servicio.
 */
export function servicePeriods(contract: Contract, today: string, lookahead: number, lastServicePeriod?: string | null): string[] {
  const startP = firstOfMonth(contract.startDate);
  const curP = firstOfMonth(today);
  const from = maxDate(startP, curP)!;
  const to = maxDate(startP, addMonths(curP, lookahead))!;
  const limits = [contract.endDate ? firstOfMonth(contract.endDate) : null, lastServicePeriod ?? null].filter(Boolean) as string[];
  const out: string[] = [];
  for (let p = from; p <= to; p = addMonths(p, 1)) {
    if (limits.some((l) => p > l)) break;
    out.push(p);
  }
  return out;
}

export type CycleSummary = { plans: number; boards: number; deliverables: number; invoices: number };

/** Genera (sin duplicar) planificación, tablero y factura de cada período aplicable. */
export async function ensureClientCycles(
  ctx: Ctx,
  client: Client,
  contract: Contract,
  periods: string[],
  settings: Settings,
): Promise<CycleSummary> {
  const summary: CycleSummary = { plans: 0, boards: 0, deliverables: 0, invoices: 0 };
  for (const period of periods) {
    if (contract.includeStrategy) {
      const r = await ensurePlan(ctx, client, contract, period, settings);
      if (r.created) summary.plans++;
    }
    const b = await ensureBoard(ctx, client, contract, period, settings);
    if (b?.created) summary.boards++;
    summary.deliverables += b?.deliverablesCreated ?? 0;
    const inv = await ensureContractInvoice(ctx, client, contract, period, settings);
    if (inv?.created) summary.invoices++;
  }
  return summary;
}

export type WorkspaceSummary = CycleSummary & {
  modules: string[];
  onboardingTasks: number;
  sessions: number;
  socialAccounts: number;
};

/**
 * Inicializa todos los espacios de un cliente según su contrato vigente.
 * Idempotente: puede ejecutarse varias veces (p. ej. tras un error) sin duplicar nada.
 */
export async function initializeClientWorkspace(
  ctx: Ctx,
  clientId: string,
  opts: { firstSessionDate?: string; onboarding?: boolean } = {},
): Promise<WorkspaceSummary> {
  const [client] = await ctx.tx.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw notFound("Cliente");
  const contract = await getActiveContract(ctx, clientId);
  const settings = await getSettings(ctx);
  const summary: WorkspaceSummary = { modules: [], onboardingTasks: 0, sessions: 0, socialAccounts: 0, plans: 0, boards: 0, deliverables: 0, invoices: 0 };
  if (!contract) return summary;
  const svc = contractServices(contract);

  const modules = [
    "administracion", "contrato", "historial", "gerencia", "facturacion", "aprobaciones",
    ...(opts.onboarding !== false ? ["incorporacion"] : []),
    ...(svc.sessions ? ["agenda"] : []),
    ...(svc.strategy ? ["estrategia"] : []),
    ...(svc.design || svc.video ? ["produccion", "entregables"] : []),
    ...(svc.design ? ["diseno"] : []),
    ...(svc.video ? ["video"] : []),
    ...(svc.community ? ["publicaciones", "community"] : []),
  ];
  const insertedModules = await ctx.tx
    .insert(clientWorkspaces)
    .values(modules.map((module) => ({ clientId, module })))
    .onConflictDoNothing()
    .returning({ module: clientWorkspaces.module });
  summary.modules = insertedModules.map((m) => m.module);

  if (opts.onboarding !== false) {
    const templates = settings.onboarding_tasks.filter((t) => !t.requires || svc[t.requires]);
    if (templates.length) {
      const created = await ctx.tx
        .insert(tasks)
        .values(
          templates.map((t) => ({
            clientId,
            title: t.title,
            department: t.department,
            assigneeId: client.accountManagerId,
            dueDate: addDays(ctx.today, t.dueInDays),
            sourceType: "onboarding",
            sourceId: contract.id,
            dedupeKey: `onboarding:${contract.id}:${t.key}`,
            createdBy: ctx.actor.userId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: tasks.id });
      summary.onboardingTasks = created.length;
    }
  }

  if (svc.community) {
    const links = client.socialLinks ?? {};
    const created = await ctx.tx
      .insert(socialAccounts)
      .values(contract.socialNetworks.map((network) => ({ clientId, network, url: links[network] ?? null })))
      .onConflictDoNothing()
      .returning({ id: socialAccounts.id });
    summary.socialAccounts = created.length;
  }

  if (svc.sessions) {
    const open = await ctx.tx
      .select({ id: contentSessions.id })
      .from(contentSessions)
      .where(and(eq(contentSessions.clientId, clientId), inArray(contentSessions.status, OPEN_SESSION_STATUSES)))
      .limit(1);
    if (!open.length) {
      const expected = opts.firstSessionDate ?? maxDate(contract.startDate, ctx.today)!;
      const created = await ctx.tx
        .insert(contentSessions)
        .values({
          clientId,
          contractId: contract.id,
          expectedDate: expected,
          coordinationStartDate: addDays(expected, -contract.coordinationLeadDays),
          clientContact: client.contactName,
          generationKey: `initial:${contract.id}`,
          createdBy: ctx.actor.userId,
        })
        .onConflictDoNothing()
        .returning({ id: contentSessions.id });
      summary.sessions = created.length;
    }
  }

  if (OPERATIVE_CLIENT_STATUSES.includes(client.status as ClientStatus)) {
    const cycles = await ensureClientCycles(ctx, client, contract, servicePeriods(contract, ctx.today, settings.cycle_lookahead_months), settings);
    Object.assign(summary, cycles);
  }
  return summary;
}

export function periodIndex(contract: Contract, period: string) {
  return monthsBetween(firstOfMonth(contract.startDate), period);
}

import { and, asc, eq, gte, inArray, isNull, lte, notInArray, or as orOp, sql } from "drizzle-orm";
import {
  clients,
  contentSessions,
  expenseCategories,
  expensePayments,
  expenses,
  invoicePayments,
  invoices,
  leads,
  monthlyContentPlans,
  payrollPeriods,
  payrollRecords,
} from "../db/schema";
import { leadCalls, tasks, employees, productionBoards as pb, productionDeliverables as pd } from "../db/schema";
import { can, requirePerm, type Ctx } from "../ctx";
import { complianceHistory } from "./publications";
import { listExpenses } from "./expenses";
import { listInvoices } from "./invoices";
import { addMonths, firstOfMonth, lastOfMonth } from "@/lib/dates";
import { CLOSED_LEAD_STATUSES, OPEN_SESSION_STATUSES, OPERATIVE_CLIENT_STATUSES } from "@/lib/domain";
import { round2, toBase } from "@/lib/money";
import { getSettings } from "./settings";
import { invoiceStatus } from "./invoices";
import { expenseStatus } from "./expenses";
import { productionOverview } from "./production";
import { sessionsNeedingAttention } from "./sessions";
import { dailyCompliance } from "./publications";
import { overdueTasks } from "./tasks";

type Money = { byCurrency: Record<string, number>; base: number };
const empty = (): Money => ({ byCurrency: {}, base: 0 });

function makeAdder(rate: number, base: string) {
  return (m: Money, amount: number, currency: string) => {
    m.byCurrency[currency] = round2((m.byCurrency[currency] ?? 0) + amount);
    m.base = round2(m.base + toBase(amount, currency, rate, base));
  };
}

/**
 * Resumen financiero del mes. Distingue:
 *  · facturado (emitido en el mes) · reconocido (servicio del mes) · cobrado (pagos recibidos en el mes)
 *  · gastos devengados (fecha contable del mes) · salidas de caja (pagos hechos en el mes)
 */
export async function financialSummary(ctx: Ctx, periodInput: string) {
  requirePerm(ctx, "finance.read");
  const settings = await getSettings(ctx);
  const add = makeAdder(settings.exchange_rate_usd_nio, settings.base_currency);
  const period = firstOfMonth(periodInput);
  const end = lastOfMonth(period);

  const allInvoices = await ctx.tx.select().from(invoices).where(sql`${invoices.status} <> 'anulada'`);
  const invoiced = empty(), recognized = empty(), receivable = empty(), overdue = empty(), collected = empty();
  for (const i of allInvoices) {
    if (i.issueDate >= period && i.issueDate <= end) add(invoiced, i.amount, i.currency);
    if ((i.period ?? firstOfMonth(i.issueDate)) === period) add(recognized, i.amount, i.currency);
    const st = invoiceStatus(i, ctx.today);
    if (st.balance > 0) add(receivable, st.balance, i.currency);
    if (st.overdue) add(overdue, st.balance, i.currency);
  }
  const pays = await ctx.tx.select().from(invoicePayments).where(and(gte(invoicePayments.paidAt, period), lte(invoicePayments.paidAt, end)));
  pays.forEach((p) => add(collected, p.amount, p.currency));

  const canExpenses = can(ctx, "expenses.read");
  const expensesAccrued = empty(), payables = empty(), cashOut = empty(), payroll = empty();
  if (canExpenses) {
    const exps = await ctx.tx.select({ e: expenses, kind: expenseCategories.kind }).from(expenses).innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId)).where(sql`${expenses.status} <> 'anulado'`);
    for (const { e, kind } of exps) {
      if (e.accountingDate >= period && e.accountingDate <= end) {
        add(expensesAccrued, e.amount, e.currency);
        if (kind === "nomina") add(payroll, e.amount, e.currency);
      }
      const st = expenseStatus(e, ctx.today);
      if (st.balance > 0) add(payables, st.balance, e.currency);
    }
    const out = await ctx.tx
      .select({ amount: expensePayments.amount, currency: expenses.currency })
      .from(expensePayments)
      .innerJoin(expenses, eq(expenses.id, expensePayments.expenseId))
      .where(and(gte(expensePayments.paidAt, period), lte(expensePayments.paidAt, end)));
    out.forEach((o) => add(cashOut, o.amount, o.currency));
  }
  return {
    period,
    baseCurrency: settings.base_currency,
    exchangeRate: settings.exchange_rate_usd_nio,
    invoiced,
    recognized,
    collected,
    receivable,
    overdue,
    expenses: canExpenses ? expensesAccrued : null,
    payables: canExpenses ? payables : null,
    payroll: canExpenses ? payroll : null,
    cashOut: canExpenses ? cashOut : null,
    netCashFlow: canExpenses ? round2(collected.base - cashOut.base) : null,
    operatingResult: canExpenses ? round2(recognized.base - expensesAccrued.base) : null,
  };
}

/** Rentabilidad por cliente: solo costos directos vinculados al cliente y, si se configuró, prorrateo de gastos generales. */
export async function clientProfitability(ctx: Ctx, periodInput: string) {
  requirePerm(ctx, "finance.read");
  requirePerm(ctx, "expenses.read");
  const settings = await getSettings(ctx);
  const rate = settings.exchange_rate_usd_nio;
  const base = settings.base_currency;
  const period = firstOfMonth(periodInput);
  const end = lastOfMonth(period);
  const cl = await ctx.tx.select({ id: clients.id, name: clients.tradeName, status: clients.status }).from(clients).orderBy(asc(clients.tradeName));
  const invs = await ctx.tx.select().from(invoices).where(sql`${invoices.status} <> 'anulada'`);
  const pays = await ctx.tx
    .select({ clientId: invoices.clientId, amount: invoicePayments.amount, currency: invoicePayments.currency })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(and(gte(invoicePayments.paidAt, period), lte(invoicePayments.paidAt, end)));
  const exps = await ctx.tx.select().from(expenses).where(and(gte(expenses.accountingDate, period), lte(expenses.accountingDate, end), sql`${expenses.status} <> 'anulado'`));
  const direct = exps.filter((e) => e.clientId);
  const overhead = round2(exps.filter((e) => !e.clientId).reduce((a, e) => a + toBase(e.amount, e.currency, rate, base), 0));
  const rows = cl.map((c) => {
    const recognized = round2(invs.filter((i) => i.clientId === c.id && (i.period ?? firstOfMonth(i.issueDate)) === period).reduce((a, i) => a + toBase(i.amount, i.currency, rate, base), 0));
    const collected = round2(pays.filter((p) => p.clientId === c.id).reduce((a, p) => a + toBase(p.amount, p.currency, rate, base), 0));
    const directCosts = round2(direct.filter((e) => e.clientId === c.id).reduce((a, e) => a + toBase(e.amount, e.currency, rate, base), 0));
    const pending = round2(invs.filter((i) => i.clientId === c.id).reduce((a, i) => a + toBase(invoiceStatus(i, ctx.today).balance, i.currency, rate, base), 0));
    return { clientId: c.id, name: c.name, status: c.status, recognized, collected, directCosts, pending, allocated: 0, margin: 0, marginRatio: null as number | null };
  });
  const totalRecognized = rows.reduce((a, r) => a + r.recognized, 0);
  for (const r of rows) {
    r.allocated = settings.overhead_allocation === "proporcional_ingresos" && totalRecognized > 0 ? round2((overhead * r.recognized) / totalRecognized) : 0;
    r.margin = round2(r.recognized - r.directCosts - r.allocated);
    r.marginRatio = r.recognized ? r.margin / r.recognized : null;
  }
  return {
    period,
    baseCurrency: base,
    allocationRule: settings.overhead_allocation,
    overhead,
    rows: rows.filter((r) => r.recognized || r.collected || r.directCosts || r.pending || OPERATIVE_CLIENT_STATUSES.includes(r.status as never)),
  };
}

/** Dashboard de Gerencia: todo calculado desde los datos reales, respetando los permisos del usuario. */
export async function managementDashboard(ctx: Ctx) {
  const period = firstOfMonth(ctx.today);
  const out: Record<string, unknown> = { today: ctx.today, period };
  if (can(ctx, "clients.read")) {
    const [c] = await ctx.tx
      .select({
        active: sql<number>`count(*) filter (where ${clients.status} in ('activo','en_incorporacion','en_proceso_baja'))::int`,
        onboarding: sql<number>`count(*) filter (where ${clients.status} = 'en_incorporacion')::int`,
        paused: sql<number>`count(*) filter (where ${clients.status} = 'en_pausa')::int`,
        archived: sql<number>`count(*) filter (where ${clients.status} in ('archivado','dado_de_baja'))::int`,
        newThisMonth: sql<number>`count(*) filter (where ${clients.createdAt} >= ${period}::date)::int`,
      })
      .from(clients);
    out.clients = c;
  }
  if (can(ctx, "leads.read")) {
    const [l] = await ctx.tx
      .select({
        toContact: sql<number>`count(*) filter (where ${leads.status} = 'pendiente_contactar')::int`,
        followupsDue: sql<number>`count(*) filter (where ${leads.nextFollowupAt} <= ${ctx.today} and ${leads.status} not in ('no_interesado','no_necesita','venta_ganada','venta_perdida'))::int`,
        open: sql<number>`count(*) filter (where ${leads.status} not in ('no_interesado','no_necesita','venta_ganada','venta_perdida'))::int`,
        wonThisMonth: sql<number>`count(*) filter (where ${leads.status} = 'venta_ganada' and ${leads.convertedAt} >= ${period}::date)::int`,
      })
      .from(leads);
    out.sales = l;
    void CLOSED_LEAD_STATUSES;
  }
  if (can(ctx, "sessions.read")) {
    const attention = await sessionsNeedingAttention(ctx);
    const upcoming = await ctx.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(contentSessions)
      .innerJoin(clients, eq(clients.id, contentSessions.clientId))
      .where(and(inArray(contentSessions.status, OPEN_SESSION_STATUSES), inArray(clients.status, OPERATIVE_CLIENT_STATUSES), sql`coalesce(${contentSessions.confirmedDate}, ${contentSessions.proposedDate}, ${contentSessions.expectedDate}) between ${ctx.today}::date and (${ctx.today}::date + 14)`));
    out.sessions = {
      attention: attention.slice(0, 8),
      attentionCount: attention.length,
      red: attention.filter((a) => a.alert.tone === "red").length,
      unconfirmed: attention.filter((a) => a.status !== "confirmada").length,
      upcoming14: upcoming[0].n,
    };
  }
  if (can(ctx, "strategy.read")) {
    const next = addMonths(period, 1);
    const [p] = await ctx.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(monthlyContentPlans)
      .innerJoin(clients, eq(clients.id, monthlyContentPlans.clientId))
      .where(and(inArray(monthlyContentPlans.period, [period, next]), isNull(monthlyContentPlans.cancelledAt), notInArray(monthlyContentPlans.status, ["aprobada", "en_produccion", "completada"]), inArray(clients.status, OPERATIVE_CLIENT_STATUSES)));
    out.plansPending = p.n;
  }
  if (can(ctx, "production.read")) {
    const rows = await productionOverview(ctx, { period });
    out.production = {
      boards: rows.length,
      ready: rows.filter((r) => r.status === "listo_para_publicar").length,
      incomplete: rows.filter((r) => r.status !== "listo_para_publicar").length,
      delayed: rows.filter((r) => r.delayed).length,
      designsPending: rows.reduce((a, r) => a + (r.designs.total - r.designs.done) + (r.profileCover.total - r.profileCover.done) + (r.stories.total - r.stories.done), 0),
      reelsPending: rows.reduce((a, r) => a + (r.reels.total - r.reels.done), 0),
      rows: rows.map((r) => ({ id: r.id, clientName: r.clientName, progress: r.progress, status: r.status, delayed: r.delayed, designs: r.designs, profileCover: r.profileCover, reels: r.reels, stories: r.stories })),
    };
  }
  if (can(ctx, "publications.read")) out.publications = (await dailyCompliance(ctx, ctx.today)).total;
  if (can(ctx, "tasks.read")) out.overdueTasks = (await overdueTasks(ctx)).length;
  if (can(ctx, "finance.read")) out.finance = await financialSummary(ctx, period);
  if (can(ctx, "payroll.read")) {
    const [pr] = await ctx.tx
      .select({ net: sql<number>`coalesce(sum(${payrollRecords.netSalary}),0)::float` })
      .from(payrollRecords)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRecords.periodId))
      .where(and(gte(payrollPeriods.periodStart, period), lte(payrollPeriods.periodEnd, lastOfMonth(period))));
    out.payrollNet = pr.net;
  }
  return out;
}

// ───────────────────────── Informes por período ─────────────────────────


export type ReportFilters = { from: string; to: string; clientId?: string; department?: string; responsibleId?: string; status?: string };

export const DATASETS = {
  produccion: "Producción por cliente y mes",
  entregables: "Entregables (diseños y reels)",
  publicaciones: "Cumplimiento de publicaciones",
  ventas: "Llamadas y gestiones de ventas",
  tareas: "Tareas",
  facturas: "Facturas y cobros",
  gastos: "Gastos",
} as const;
export type Dataset = keyof typeof DATASETS;

const DATASET_PERMS: Record<Dataset, Parameters<typeof can>[1]> = {
  produccion: "production.read",
  entregables: "production.read",
  publicaciones: "publications.read",
  ventas: "leads.read",
  tareas: "tasks.read",
  facturas: "finance.read",
  gastos: "expenses.read",
};

export function availableDatasets(ctx: Ctx) {
  return (Object.keys(DATASETS) as Dataset[]).filter((k) => can(ctx, DATASET_PERMS[k]));
}

/** Filas de un informe (mismas que se exportan a CSV). */
export async function reportRows(ctx: Ctx, dataset: Dataset, f: ReportFilters): Promise<Record<string, string | number | null>[]> {
  requirePerm(ctx, "reports.read");
  requirePerm(ctx, DATASET_PERMS[dataset]);
  const fromP = firstOfMonth(f.from);
  switch (dataset) {
    case "produccion": {
      const rows: Record<string, string | number | null>[] = [];
      for (let p = fromP; p <= f.to; p = addMonths(p, 1)) {
        const list = await productionOverview(ctx, { period: p, clientId: f.clientId, designerId: f.responsibleId, status: f.status });
        list.forEach((r) => rows.push({ mes: p.slice(0, 7), cliente: r.clientName, disenos: `${r.designs.done}/${r.designs.total}`, perfil_portada: `${r.profileCover.done}/${r.profileCover.total}`, reels: `${r.reels.done}/${r.reels.total}`, stories: `${r.stories.done}/${r.stories.total}`, avance: Math.round(r.progress * 1000) / 10, estado: r.status, retraso: r.delayed ? "sí" : "no", disenador: r.designer, editor: r.editor }));
      }
      return rows;
    }
    case "entregables": {
      const conds = [gte(pb.period, fromP), lte(pb.period, f.to)];
      if (f.clientId) conds.push(eq(pd.clientId, f.clientId));
      if (f.responsibleId) conds.push(eq(pd.assigneeId, f.responsibleId));
      if (f.status) conds.push(eq(pd.status, f.status));
      const rows = await ctx.tx
        .select({ d: pd, period: pb.period, client: clients.tradeName, assignee: employees.fullName })
        .from(pd)
        .innerJoin(pb, eq(pb.id, pd.boardId))
        .innerJoin(clients, eq(clients.id, pd.clientId))
        .leftJoin(employees, eq(employees.id, pd.assigneeId))
        .where(and(...conds));
      return rows.map((r) => ({ mes: r.period.slice(0, 7), cliente: r.client, entregable: r.d.title, tipo: r.d.kind, responsable: r.assignee, fecha_limite: r.d.dueDate, estado: r.d.status, completado: r.d.completedAt?.toISOString() ?? null, archivo: r.d.finalFileUrl }));
    }
    case "publicaciones": {
      const scope = f.clientId ? `client:${f.clientId}` : f.responsibleId ? `cm:${f.responsibleId}` : "total";
      const rows = await complianceHistory(ctx, { from: f.from, to: f.to, groupBy: "day", scope });
      return rows.map((r) => ({ dia: r.key, previstas: r.planned, publicadas: r.published, fallidas: r.failed, pendientes: r.pending, cumplimiento: r.ratio === null ? null : Math.round(r.ratio * 1000) / 10, clientes_cumplieron: `${r.clientsCompliant}/${r.clientsPlanned}` }));
    }
    case "ventas": {
      const conds = [gte(leadCalls.calledAt, new Date(`${f.from}T00:00:00-06:00`)), lte(leadCalls.calledAt, new Date(`${f.to}T23:59:59-06:00`))];
      if (f.responsibleId) conds.push(eq(leadCalls.agentId, f.responsibleId));
      const rows = await ctx.tx
        .select({ c: leadCalls, lead: leads.tradeName, agent: employees.fullName })
        .from(leadCalls)
        .innerJoin(leads, eq(leads.id, leadCalls.leadId))
        .leftJoin(employees, eq(employees.id, leadCalls.agentId))
        .where(and(...conds));
      return rows.map((r) => ({ fecha: r.c.calledAt.toISOString(), prospecto: r.lead, agente: r.agent, canal: r.c.channel, resultado: r.c.result, interes: r.c.interestLevel, estado_resultante: r.c.statusAfter, proxima_accion: r.c.nextAction, seguimiento: r.c.nextFollowupAt }));
    }
    case "tareas": {
      const conds = [orOp(and(gte(tasks.dueDate, f.from), lte(tasks.dueDate, f.to)), and(gte(tasks.createdAt, new Date(`${f.from}T00:00:00-06:00`)), lte(tasks.createdAt, new Date(`${f.to}T23:59:59-06:00`))))!];
      if (f.clientId) conds.push(eq(tasks.clientId, f.clientId));
      if (f.department) conds.push(eq(tasks.department, f.department));
      if (f.responsibleId) conds.push(eq(tasks.assigneeId, f.responsibleId));
      if (f.status) conds.push(eq(tasks.status, f.status));
      const rows = await ctx.tx
        .select({ t: tasks, client: clients.tradeName, assignee: employees.fullName })
        .from(tasks)
        .leftJoin(clients, eq(clients.id, tasks.clientId))
        .leftJoin(employees, eq(employees.id, tasks.assigneeId))
        .where(and(...conds));
      return rows.map((r) => ({ tarea: r.t.title, cliente: r.client, departamento: r.t.department, responsable: r.assignee, vence: r.t.dueDate, estado: r.t.status, completada: r.t.completedAt?.toISOString() ?? null, atrasada: r.t.dueDate && r.t.dueDate < ctx.today && ["pendiente", "en_progreso"].includes(r.t.status) ? "sí" : "no" }));
    }
    case "facturas": {
      const rows = await listInvoices(ctx, { from: f.from, to: f.to, clientId: f.clientId, status: f.status });
      return rows.map((i) => ({ numero: i.number, cliente: i.clientName, concepto: i.concept, emision: i.issueDate, vencimiento: i.dueDate, importe: i.amount, pagado: i.paidAmount, saldo: i.balance, moneda: i.currency, estado: i.status }));
    }
    case "gastos": {
      const rows: Record<string, string | number | null>[] = [];
      for (let p = fromP; p <= f.to; p = addMonths(p, 1)) {
        const list = await listExpenses(ctx, { period: p, status: f.status });
        list
          .filter((e) => e.accountingDate >= f.from && e.accountingDate <= f.to && (!f.clientId || e.clientId === f.clientId) && (!f.department || e.department === f.department))
          .forEach((e) => rows.push({ fecha_contable: e.accountingDate, gasto: e.name, categoria: e.categoryName, proveedor: e.supplier, importe: e.amount, pagado: e.paidAmount, saldo: e.balance, moneda: e.currency, vence: e.dueDate, estado: e.status, origen: e.sourceType }));
      }
      return rows;
    }
  }
}

export function toCSV(rows: Record<string, string | number | null>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

import { and, desc, eq, inArray, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import {
  automationRuns,
  clientOffboardingRecords,
  clients,
  dailyPublicationSnapshots,
  employees,
  expenses,
  invoices,
  leads,
  monthlyContentPlans,
  productionBoards,
  productionDeliverables,
  publications,
} from "../db/schema";
import { systemActor, withCtx, type Ctx } from "../ctx";
import { addDays, diffDays, formatDate, formatPeriod, lastOfMonth, todayISO } from "@/lib/dates";
import { OPERATIVE_CLIENT_STATUSES, CLOSED_LEAD_STATUSES } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { getSettings } from "../services/settings";
import { ensureClientCycles, getActiveContract, servicePeriods } from "../services/workspace";
import { completeDueOffboardings } from "../services/clients";
import { generateRecurringExpenses } from "../services/expenses";
import { sessionsNeedingAttention } from "../services/sessions";
import { closePublicationDay } from "../services/publications";
import { overdueTasks } from "../services/tasks";
import { upcomingPayrolls } from "../services/payroll";
import { notify } from "../services/notifications";
import { invoiceStatus } from "../services/invoices";
import { expenseStatus } from "../services/expenses";
import { computeBoardProgress } from "../services/production";

type Stats = Record<string, number>;
export type Job = { key: string; name: string; run: (ctx: Ctx) => Promise<Stats> };

export const JOBS: Job[] = [
  {
    key: "monthly_cycles",
    name: "Ciclos mensuales (planificaciones, tableros, facturas y bajas programadas)",
    async run(ctx) {
      const stats: Stats = { clients: 0, plans: 0, boards: 0, deliverables: 0, invoices: 0, offboardingsCompleted: 0 };
      stats.offboardingsCompleted = await completeDueOffboardings(ctx);
      const settings = await getSettings(ctx);
      const list = await ctx.tx.select().from(clients).where(inArray(clients.status, OPERATIVE_CLIENT_STATUSES));
      for (const client of list) {
        const contract = await getActiveContract(ctx, client.id);
        if (!contract) continue;
        const [off] = await ctx.tx
          .select()
          .from(clientOffboardingRecords)
          .where(and(eq(clientOffboardingRecords.clientId, client.id), isNull(clientOffboardingRecords.completedAt)))
          .orderBy(desc(clientOffboardingRecords.createdAt))
          .limit(1);
        const r = await ensureClientCycles(ctx, client, contract, servicePeriods(contract, ctx.today, settings.cycle_lookahead_months, off?.lastServicePeriod), settings);
        stats.clients++;
        stats.plans += r.plans;
        stats.boards += r.boards;
        stats.deliverables += r.deliverables;
        stats.invoices += r.invoices;
      }
      return stats;
    },
  },
  {
    key: "recurring_expenses",
    name: "Gastos recurrentes",
    async run(ctx) {
      return { created: await generateRecurringExpenses(ctx) };
    },
  },
  {
    key: "session_alerts",
    name: "Alertas de sesiones de contenido",
    async run(ctx) {
      const list = await sessionsNeedingAttention(ctx);
      let sent = 0;
      for (const s of list) {
        // Un aviso por sesión y nivel (amarillo/rojo) y estado: no se repite cada día.
        sent += await notify(ctx, {
          type: "session_attention",
          severity: s.alert.tone === "red" ? "critical" : "warning",
          title: `${s.clientName}: ${s.alert.label}`,
          link: `/agenda?sesion=${s.id}`,
          entityType: "content_session",
          entityId: s.id,
          dedupeKey: `session:${s.id}:${s.alert.tone}:${s.status}:${s.alert.label.split(" ")[0]}`,
          employeeIds: [s.responsibleId],
        });
      }
      return { attention: list.length, sent };
    },
  },
  {
    key: "strategy_alerts",
    name: "Planificaciones pendientes",
    async run(ctx) {
      const rows = await ctx.tx
        .select({ p: monthlyContentPlans, clientName: clients.tradeName })
        .from(monthlyContentPlans)
        .innerJoin(clients, eq(clients.id, monthlyContentPlans.clientId))
        .where(
          and(
            isNull(monthlyContentPlans.cancelledAt),
            notInArray(monthlyContentPlans.status, ["aprobada", "en_produccion", "completada"]),
            inArray(clients.status, OPERATIVE_CLIENT_STATUSES),
            lte(monthlyContentPlans.dueDate, addDays(ctx.today, 3)),
          ),
        );
      let sent = 0;
      for (const { p, clientName } of rows) {
        const overdue = p.dueDate! < ctx.today;
        sent += await notify(ctx, {
          type: "plan_pending",
          severity: overdue ? "critical" : "warning",
          title: `Planificación ${overdue ? "atrasada" : "por vencer"}: ${clientName} · ${formatPeriod(p.period)}`,
          body: `Fecha límite: ${formatDate(p.dueDate)}`,
          link: `/estrategia/${p.id}`,
          entityType: "content_plan",
          entityId: p.id,
          dedupeKey: `plan:${p.id}:${overdue ? "overdue" : "due"}`,
          employeeIds: [p.strategistId],
        });
      }
      return { pending: rows.length, sent };
    },
  },
  {
    key: "production_alerts",
    name: "Diseños y reels atrasados / producción incompleta",
    async run(ctx) {
      const late = await ctx.tx
        .select({ d: productionDeliverables, clientName: clients.tradeName, period: productionBoards.period })
        .from(productionDeliverables)
        .innerJoin(productionBoards, eq(productionBoards.id, productionDeliverables.boardId))
        .innerJoin(clients, eq(clients.id, productionDeliverables.clientId))
        .where(
          and(
            isNull(productionBoards.cancelledAt),
            inArray(clients.status, OPERATIVE_CLIENT_STATUSES),
            notInArray(productionDeliverables.status, ["finalizado", "editado"]),
            lt(productionDeliverables.dueDate, ctx.today),
          ),
        );
      let sent = 0;
      for (const { d, clientName, period } of late) {
        sent += await notify(ctx, {
          type: "deliverable_overdue",
          severity: "critical",
          title: `Atrasado: ${clientName} · ${d.title}`,
          body: `${formatPeriod(period)} · vencía el ${formatDate(d.dueDate)}`,
          link: `/produccion/${d.boardId}`,
          entityType: "deliverable",
          entityId: d.id,
          dedupeKey: `deliverable_overdue:${d.id}:${d.dueDate}`,
          employeeIds: [d.assigneeId],
          broadcast: false,
        });
      }
      // Tableros de meses cerrados sin completar.
      const boards = await ctx.tx
        .select({ b: productionBoards, clientName: clients.tradeName })
        .from(productionBoards)
        .innerJoin(clients, eq(clients.id, productionBoards.clientId))
        .where(and(isNull(productionBoards.cancelledAt), isNull(productionBoards.readyAt), inArray(clients.status, OPERATIVE_CLIENT_STATUSES), lte(productionBoards.dueDate, ctx.today)));
      let incomplete = 0;
      for (const { b, clientName } of boards) {
        const items = await ctx.tx.select().from(productionDeliverables).where(eq(productionDeliverables.boardId, b.id));
        const p = computeBoardProgress(b, items, ctx.today);
        if (p.status === "listo_para_publicar") continue;
        incomplete++;
        sent += await notify(ctx, {
          type: "production_incomplete",
          severity: "critical",
          title: `Producción incompleta: ${clientName} · ${formatPeriod(b.period)}`,
          body: `${p.done}/${p.total} entregables terminados (diseños ${p.designs.done}/${p.designs.total}, perfil y portada ${p.profileCover.done}/${p.profileCover.total}, reels ${p.reels.done}/${p.reels.total}).`,
          link: `/produccion/${b.id}`,
          entityType: "production_board",
          entityId: b.id,
          dedupeKey: `board_incomplete:${b.id}:${p.status}`,
          employeeIds: [b.designerId, b.editorId],
        });
      }
      return { lateDeliverables: late.length, incompleteBoards: incomplete, sent };
    },
  },
  {
    key: "publication_day_close",
    name: "Cierre diario de publicaciones y pendientes de hoy",
    async run(ctx) {
      let closed = 0;
      for (let i = 7; i >= 1; i--) {
        const d = addDays(ctx.today, -i);
        const [exists] = await ctx.tx.select({ id: dailyPublicationSnapshots.id }).from(dailyPublicationSnapshots).where(eq(dailyPublicationSnapshots.day, d)).limit(1);
        if (!exists) closed += (await closePublicationDay(ctx, d)) > 0 ? 1 : 0;
      }
      const today = await ctx.tx
        .select({ responsibleId: publications.responsibleId, n: sql<number>`count(*)::int` })
        .from(publications)
        .innerJoin(clients, eq(clients.id, publications.clientId))
        .where(and(eq(publications.scheduledDate, ctx.today), inArray(publications.status, ["pendiente", "lista_programar", "programada"]), inArray(clients.status, OPERATIVE_CLIENT_STATUSES)))
        .groupBy(publications.responsibleId);
      let sent = 0;
      for (const t of today) {
        sent += await notify(ctx, {
          type: "publication_pending",
          severity: "warning",
          title: `Hoy hay ${t.n} publicación(es) pendiente(s)`,
          link: "/publicaciones",
          dedupeKey: `pub_pending:${t.responsibleId ?? "sin_asignar"}:${ctx.today}`,
          employeeIds: [t.responsibleId],
        });
      }
      return { daysClosed: closed, sent };
    },
  },
  {
    key: "finance_alerts",
    name: "Facturas por vencer, cobros atrasados y gastos por vencer",
    async run(ctx) {
      const settings = await getSettings(ctx);
      let sent = 0;
      const open = await ctx.tx
        .select({ i: invoices, clientName: clients.tradeName })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(inArray(invoices.status, ["pendiente", "parcial"]));
      for (const { i, clientName } of open) {
        const st = invoiceStatus(i, ctx.today);
        const days = diffDays(i.dueDate, ctx.today);
        if (st.overdue) {
          sent += await notify(ctx, { type: "invoice_overdue", severity: "critical", title: `Cobro atrasado: ${clientName} · ${i.number}`, body: `Saldo ${formatMoney(st.balance, i.currency)} · venció el ${formatDate(i.dueDate)}`, link: `/finanzas/facturas/${i.id}`, entityType: "invoice", entityId: i.id, dedupeKey: `invoice_overdue:${i.id}` });
        } else if (days <= settings.invoice_due_notice_days) {
          sent += await notify(ctx, { type: "invoice_due", severity: "warning", title: `Factura por vencer: ${clientName} · ${i.number}`, body: `${formatMoney(st.balance, i.currency)} · vence el ${formatDate(i.dueDate)}`, link: `/finanzas/facturas/${i.id}`, entityType: "invoice", entityId: i.id, dedupeKey: `invoice_due:${i.id}` });
        }
      }
      const exps = await ctx.tx.select().from(expenses).where(and(inArray(expenses.status, ["pendiente", "parcial"]), lte(expenses.dueDate, addDays(ctx.today, settings.expense_due_notice_days))));
      for (const e of exps) {
        const st = expenseStatus(e, ctx.today);
        sent += await notify(ctx, {
          type: "expense_due",
          severity: st.overdue ? "critical" : "warning",
          title: `${st.overdue ? "Gasto vencido" : "Gasto por vencer"}: ${e.name}`,
          body: `${formatMoney(st.balance, e.currency)} · vence el ${formatDate(e.dueDate)}`,
          link: `/gastos?gasto=${e.id}`,
          entityType: "expense",
          entityId: e.id,
          dedupeKey: `expense:${e.id}:${st.overdue ? "overdue" : "due"}`,
        });
      }
      return { openInvoices: open.length, expensesDue: exps.length, sent };
    },
  },
  {
    key: "task_alerts",
    name: "Tareas atrasadas y seguimientos de ventas",
    async run(ctx) {
      let sent = 0;
      const late = await overdueTasks(ctx);
      for (const t of late) {
        sent += await notify(ctx, { type: "task_overdue", severity: "warning", title: `Tarea atrasada: ${t.task.title}`, body: `${t.clientName ? t.clientName + " · " : ""}vencía el ${formatDate(t.task.dueDate)}`, link: "/tareas", entityType: "task", entityId: t.task.id, dedupeKey: `task_overdue:${t.task.id}:${t.task.dueDate}`, employeeIds: [t.task.assigneeId], broadcast: !t.task.assigneeId });
      }
      const follow = await ctx.tx.select().from(leads).where(and(eq(leads.nextFollowupAt, ctx.today), notInArray(leads.status, CLOSED_LEAD_STATUSES)));
      for (const l of follow) {
        sent += await notify(ctx, { type: "lead_followup", title: `Seguimiento hoy: ${l.tradeName}`, body: l.nextAction ?? undefined, link: `/ventas/${l.id}`, entityType: "lead", entityId: l.id, dedupeKey: `lead_followup:${l.id}:${ctx.today}`, employeeIds: [l.ownerId], broadcast: !l.ownerId });
      }
      return { overdueTasks: late.length, followups: follow.length, sent };
    },
  },
  {
    key: "payroll_alerts",
    name: "Nóminas próximas a preparar",
    async run(ctx) {
      const settings = await getSettings(ctx);
      const [{ n }] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(eq(employees.status, "activo"));
      if (!n) return { upcoming: 0, sent: 0 };
      let sent = 0;
      const list = await upcomingPayrolls(ctx);
      for (const p of list) {
        if (p.existing && p.existing.status !== "borrador") continue;
        if (diffDays(p.payDate, ctx.today) > settings.payroll_prepare_days) continue;
        sent += await notify(ctx, {
          type: "payroll_prepare",
          severity: "warning",
          title: `Preparar nómina ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`,
          body: `Fecha de pago: ${formatDate(p.payDate)}${p.existing ? " · está en borrador" : ""}`,
          link: "/nomina",
          dedupeKey: `payroll_prepare:${p.periodStart}`,
        });
      }
      // Fin de mes: recordar obligaciones administrativas con gastos sin categoría fiscal pagados.
      if (lastOfMonth(ctx.today) === ctx.today) {
        sent += await notify(ctx, { type: "admin_obligation", title: "Cierre de mes: revisar obligaciones fiscales y administrativas", link: "/gastos", dedupeKey: `month_close:${ctx.today}` });
      }
      return { upcoming: list.length, sent };
    },
  },
];

export type RunResult = { job: string; status: "succeeded" | "failed" | "skipped"; stats?: Stats; error?: string; attempts?: number };

/**
 * Ejecuta las automatizaciones. Cada trabajo:
 *  · corre en su propia transacción (todo o nada) con privilegios de sistema
 *  · se registra en automation_runs con una clave única por día (no se repite si ya tuvo éxito)
 *  · si falla, guarda el error y puede reintentarse con seguridad (los trabajos son idempotentes)
 */
export async function runAutomations(opts: { now?: Date; jobs?: string[]; triggeredBy?: string; force?: boolean } = {}): Promise<RunResult[]> {
  const now = opts.now ?? new Date();
  const today = todayISO(now);
  const results: RunResult[] = [];
  const selected = JOBS.filter((j) => !opts.jobs || opts.jobs.includes(j.key));
  for (const job of selected) {
    const runKey = `${job.key}:${today}`;
    const claim = await withCtx(systemActor("automations"), async ({ tx }) => {
      const [existing] = await tx.select().from(automationRuns).where(eq(automationRuns.runKey, runKey)).for("update");
      if (existing?.status === "succeeded" && !opts.force) return { skip: true as const, attempts: existing.attempts };
      if (existing?.status === "running" && Date.now() - existing.startedAt.getTime() < 15 * 60_000) return { skip: true as const, attempts: existing.attempts };
      if (existing) {
        const [r] = await tx
          .update(automationRuns)
          .set({ status: "running", attempts: existing.attempts + 1, startedAt: new Date(), finishedAt: null, error: null, triggeredBy: opts.triggeredBy ?? "cron" })
          .where(eq(automationRuns.id, existing.id))
          .returning();
        return { skip: false as const, id: r.id, attempts: r.attempts };
      }
      const [r] = await tx.insert(automationRuns).values({ jobKey: job.key, runKey, status: "running", triggeredBy: opts.triggeredBy ?? "cron" }).returning();
      return { skip: false as const, id: r.id, attempts: 1 };
    });
    if (claim.skip) {
      results.push({ job: job.key, status: "skipped", attempts: claim.attempts });
      continue;
    }
    try {
      const stats = await withCtx(systemActor("automations"), (ctx) => job.run(ctx), { now });
      await withCtx(systemActor("automations"), ({ tx }) => tx.update(automationRuns).set({ status: "succeeded", stats, finishedAt: new Date() }).where(eq(automationRuns.id, claim.id)));
      results.push({ job: job.key, status: "succeeded", stats, attempts: claim.attempts });
    } catch (e) {
      const message = e instanceof Error ? `${e.message}` : String(e);
      await withCtx(systemActor("automations"), async (ctx) => {
        await ctx.tx.update(automationRuns).set({ status: "failed", error: message.slice(0, 4000), finishedAt: new Date() }).where(eq(automationRuns.id, claim.id));
        await notify(ctx, { type: "automation_failed", severity: "critical", title: `Falló la automatización: ${job.name}`, body: message.slice(0, 300), link: "/configuracion/automatizaciones", dedupeKey: `automation_failed:${runKey}:${claim.attempts}` });
      });
      results.push({ job: job.key, status: "failed", error: message, attempts: claim.attempts });
    }
  }
  return results;
}

export async function listAutomationRuns(limit = 100) {
  return withCtx(systemActor("automations"), ({ tx }) => tx.select().from(automationRuns).orderBy(desc(automationRuns.startedAt)).limit(limit));
}


import Link from "next/link";
import { load } from "./_lib/page";
import { managementDashboard } from "@/server/services/reports";
import { listTasks } from "@/server/services/tasks";
import { myDeliverables } from "@/server/services/production";
import { Badge, Card, Empty, PageHeader, Progress, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { BOARD_STATUSES, DESIGN_STATUSES, VIDEO_STATUSES } from "@/lib/domain";
import { formatDate, formatPeriod } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";

type Money = { byCurrency: Record<string, number>; base: number } | null | undefined;
const money = (m: Money, base = "NIO") => (m ? formatMoney(m.base, base) : "—");

export default async function Dashboard() {
  const d = await load([], async (ctx) => ({
    dash: (await managementDashboard(ctx)) as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    tasks: await listTasks(ctx, { scope: "mias" }),
    mine: await myDeliverables(ctx),
  }));
  const { dash } = d;
  const fin = dash.finance;
  const base = fin?.baseCurrency ?? "NIO";
  return (
    <>
      <PageHeader title={`Hola, ${d.actor.name.split(" ")[0]}`} subtitle={`${formatDate(dash.today, { withWeekday: true })} · ${formatPeriod(dash.period)}`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {dash.clients && <Stat label="Clientes activos" value={dash.clients.active} hint={`${dash.clients.newThisMonth} nuevos este mes · ${dash.clients.onboarding} en incorporación`} href="/clientes" />}
        {dash.sales && <Stat label="Prospectos por contactar" value={dash.sales.toContact} hint={`${dash.sales.followupsDue} seguimientos hoy · ${dash.sales.wonThisMonth} ganadas`} href="/ventas" tone={dash.sales.followupsDue ? "yellow" : undefined} />}
        {dash.sessions && <Stat label="Sesiones que requieren atención" value={dash.sessions.attentionCount} hint={`${dash.sessions.red} críticas · ${dash.sessions.upcoming14} en 14 días`} href="/agenda" tone={dash.sessions.red ? "red" : dash.sessions.attentionCount ? "yellow" : "green"} />}
        {dash.plansPending !== undefined && <Stat label="Planificaciones pendientes" value={dash.plansPending} hint="Mes actual y siguiente" href="/estrategia" tone={dash.plansPending ? "yellow" : "green"} />}
        {dash.production && <Stat label="Listos para publicar" value={`${dash.production.ready}/${dash.production.boards}`} hint={`${dash.production.delayed} con retraso`} href="/produccion" tone={dash.production.delayed ? "red" : undefined} />}
        {dash.publications && <Stat label="Publicaciones de hoy" value={dash.publications.ratio === null ? "—" : formatPercent(dash.publications.ratio)} hint={`${dash.publications.published}/${dash.publications.planned} publicadas · ${dash.publications.failed} fallidas`} href="/publicaciones" tone={dash.publications.failed ? "red" : undefined} />}
        {dash.production && <Stat label="Diseños pendientes" value={dash.production.designsPending} hint="Incluye perfil, portada y stories" href="/produccion" />}
        {dash.production && <Stat label="Reels pendientes" value={dash.production.reelsPending} href="/produccion" />}
        {dash.overdueTasks !== undefined && <Stat label="Tareas atrasadas" value={dash.overdueTasks} href="/tareas?scope=todas&overdue=1" tone={dash.overdueTasks ? "red" : "green"} />}
        {fin && <Stat label="Cobrado este mes" value={money(fin.collected, base)} hint={`Facturado ${money(fin.invoiced, base)}`} href="/finanzas" />}
        {fin && <Stat label="Por cobrar" value={money(fin.receivable, base)} hint={`Vencido ${money(fin.overdue, base)}`} href="/finanzas/facturas" tone={fin.overdue?.base ? "red" : undefined} />}
        {fin?.expenses && <Stat label="Gastos del mes" value={money(fin.expenses, base)} hint={`Por pagar ${money(fin.payables, base)}`} href="/gastos" />}
        {dash.payrollNet !== undefined && <Stat label="Nómina neta del mes" value={formatMoney(dash.payrollNet, "NIO")} href="/nomina" />}
        {fin?.operatingResult !== null && fin?.operatingResult !== undefined && <Stat label="Resultado operativo estimado" value={formatMoney(fin.operatingResult, base)} hint="Ingreso reconocido − gastos devengados" href="/finanzas" tone={fin.operatingResult < 0 ? "red" : "green"} />}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {dash.production && (
          <Card title={`Producción de ${formatPeriod(dash.period)}`} actions={<Link className="text-xs text-brand-700" href="/produccion">Ver todo</Link>} padded={false}>
            {dash.production.rows.length ? (
              <Table>
                <thead><tr><Th>Cliente</Th><Th>Diseños</Th><Th>Perfil/portada</Th><Th>Reels</Th><Th>Stories</Th><Th className="w-32">Avance</Th><Th>Estado</Th></tr></thead>
                <tbody>
                  {dash.production.rows.map((r: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <tr key={r.id}>
                      <Td><Link href={`/produccion/${r.id}`} className="font-medium hover:underline">{r.clientName}</Link></Td>
                      <Td className="tabular">{r.designs.done}/{r.designs.total}</Td>
                      <Td className="tabular">{r.profileCover.done}/{r.profileCover.total}</Td>
                      <Td className="tabular">{r.reels.done}/{r.reels.total}</Td>
                      <Td className="tabular">{r.stories.total ? `${r.stories.done}/${r.stories.total}` : "—"}</Td>
                      <Td><div className="flex items-center gap-2"><Progress value={r.progress} tone={r.delayed ? "red" : undefined} /><span className="text-xs tabular">{formatPercent(r.progress)}</span></div></Td>
                      <Td><StatusBadge list={BOARD_STATUSES} value={r.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <div className="p-4"><Empty>No hay tableros este mes.</Empty></div>}
          </Card>
        )}
        {dash.sessions && (
          <Card title="Sesiones que requieren atención" actions={<Link className="text-xs text-brand-700" href="/agenda">Agenda</Link>}>
            {dash.sessions.attention.length ? (
              <ul className="divide-y divide-slate-100">
                {dash.sessions.attention.map((s: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/agenda?sesion=${s.id}`} className="font-medium hover:underline">{s.clientName}</Link>
                    <Badge tone={s.alert.tone}>{s.alert.label}</Badge>
                  </li>
                ))}
              </ul>
            ) : <Empty>Ninguna sesión requiere atención.</Empty>}
          </Card>
        )}
        <Card title="Mis tareas" actions={<Link className="text-xs text-brand-700" href="/tareas">Ver todas</Link>}>
          {d.tasks.length ? (
            <ul className="divide-y divide-slate-100">
              {d.tasks.slice(0, 8).map((t) => (
                <li key={t.task.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{t.task.title}{t.clientName && <span className="text-slate-500"> · {t.clientName}</span>}</span>
                  <Badge tone={t.task.dueDate && t.task.dueDate < dash.today ? "red" : "gray"}>{formatDate(t.task.dueDate)}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty>No tienes tareas pendientes.</Empty>}
        </Card>
        {d.mine.length > 0 && (
          <Card title="Mis entregables pendientes">
            <ul className="divide-y divide-slate-100">
              {d.mine.slice(0, 10).map((m) => (
                <li key={m.d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/produccion/${m.d.boardId}`} className="hover:underline">{m.clientName} · {m.d.title}</Link>
                  <StatusBadge list={m.d.kind === "reel" ? VIDEO_STATUSES : DESIGN_STATUSES} value={m.d.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

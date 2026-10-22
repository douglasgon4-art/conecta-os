import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { complianceHistory, contentForCommunity, dailyCompliance, listPublicationsForDay } from "@/server/services/publications";
import { listClients } from "@/server/services/clients";
import { listAssignableEmployees } from "@/server/services/employees";
import { Badge, Card, Empty, Field, Input, PageHeader, Progress, Select, Stat, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DESIGN_STATUSES, PUBLICATION_STATUSES, SOCIAL_NETWORKS, VIDEO_STATUSES, labelOf } from "@/lib/domain";
import { addDays, formatDate, formatDateTime, formatPeriod } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { createPublicationAction, reschedulePublicationAction, updatePublicationAction } from "./actions";

export const metadata = { title: "Community Management" };

export default async function PublicationsPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const tab = sp(q.tab) ?? "hoy";
  const d = await load(["publications.read"], async (ctx) => {
    const day = sp(q.fecha) ?? ctx.today;
    const base = { day, today: ctx.today, manage: can(ctx, "publications.manage"), own: can(ctx, "publications.update_own"), me: ctx.actor.employeeId };
    if (tab === "contenido") return { ...base, content: await contentForCommunity(ctx, sp(q.cliente)) };
    if (tab === "historial") {
      const from = sp(q.desde) ?? addDays(ctx.today, -30);
      const to = sp(q.hasta) ?? ctx.today;
      return { ...base, from, to, history: await complianceHistory(ctx, { from, to, groupBy: (sp(q.agrupar) as "day") ?? "day", scope: sp(q.alcance) ?? "total" }), employees: await listAssignableEmployees(ctx), clients: await listClients(ctx, { scope: "todos" }) };
    }
    return {
      ...base,
      compliance: await dailyCompliance(ctx, day),
      rows: await listPublicationsForDay(ctx, day, { clientId: sp(q.cliente), network: sp(q.red), responsibleId: sp(q.cm) }),
      clients: await listClients(ctx, { scope: "operativos" }),
      employees: await listAssignableEmployees(ctx),
    };
  });
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const D = d as Any;
  const editable = (p: { responsibleId: string | null }) => d.manage || (d.own && p.responsibleId === d.me);
  return (
    <>
      <PageHeader title="Community Management" subtitle="Cada publicación se confirma individualmente. Los días cerrados conservan su resultado." />
      <Tabs active={tab} tabs={[{ key: "hoy", label: "Control diario", href: "/publicaciones" }, { key: "contenido", label: "Contenido listo para publicar", href: "/publicaciones?tab=contenido" }, { key: "historial", label: "Historial y estadísticas", href: "/publicaciones?tab=historial" }]} />

      {tab === "hoy" && (
        <>
          <form className="mb-4 flex flex-wrap items-center gap-2">
            <Link href={`/publicaciones?fecha=${addDays(d.day, -1)}`} className="rounded-md border px-2 py-1.5 text-sm">‹</Link>
            <Input type="date" name="fecha" defaultValue={d.day} className="w-44" />
            <Link href={`/publicaciones?fecha=${addDays(d.day, 1)}`} className="rounded-md border px-2 py-1.5 text-sm">›</Link>
            <Select name="cliente" defaultValue={sp(q.cliente) ?? ""} className="max-w-44"><option value="">Todos los clientes</option>{D.clients.map((c: Any) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select>
            <Select name="red" defaultValue={sp(q.red) ?? ""} className="max-w-40"><option value="">Todas las redes</option>{SOCIAL_NETWORKS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}</Select>
            <Select name="cm" defaultValue={sp(q.cm) ?? ""} className="max-w-44"><option value="">Todo CM</option>{D.employees.map((e: Any) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select>
            <button className="h-9 rounded-md border px-3 text-sm">Ver</button>
            {D.compliance.closed && <Badge tone="blue">Día cerrado: resultado inmutable</Badge>}
          </form>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={`${formatDate(d.day, { withWeekday: true })}: clientes que cumplieron`} value={D.compliance.total.clientsPlanned ? `${D.compliance.total.clientsCompliant} de ${D.compliance.total.clientsPlanned}` : "—"} hint={D.compliance.total.clientRatio !== null ? formatPercent(D.compliance.total.clientRatio) : "Sin publicaciones previstas"} tone={D.compliance.total.clientRatio === 1 ? "green" : undefined} />
            <Stat label="Publicaciones realizadas" value={`${D.compliance.total.published}/${D.compliance.total.planned}`} hint={D.compliance.total.ratio !== null ? formatPercent(D.compliance.total.ratio) : ""} />
            <Stat label="Pendientes" value={D.compliance.total.pending} tone={D.compliance.total.pending ? "yellow" : undefined} />
            <Stat label="Fallidas" value={D.compliance.total.failed} tone={D.compliance.total.failed ? "red" : undefined} />
          </div>
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <Card title="Cumplimiento por red social">{D.compliance.byNetwork.length ? D.compliance.byNetwork.map((n: Any) => <div key={n.key} className="mb-2 text-sm"><div className="flex justify-between"><span>{n.name}</span><span className="tabular">{n.published}/{n.planned}</span></div><Progress value={n.ratio ?? 0} /></div>) : <Empty>Sin obligaciones.</Empty>}</Card>
            <Card title="Cumplimiento por Community Manager">{D.compliance.byCm.length ? D.compliance.byCm.map((n: Any) => <div key={n.key} className="mb-2 text-sm"><div className="flex justify-between"><span>{n.name}</span><span className="tabular">{n.published}/{n.planned}</span></div><Progress value={n.ratio ?? 0} /></div>) : <Empty>Sin obligaciones.</Empty>}</Card>
          </div>
          <Card title="Checklist del día" padded={false}>
            {D.rows.length ? (
              <Table>
                <thead><tr><Th>Cliente</Th><Th>Red</Th><Th>Contenido</Th><Th>Responsable</Th><Th>Estado</Th><Th>Confirmación</Th><Th>Acciones</Th></tr></thead>
                <tbody>{D.rows.map((r: Any) => (
                  <tr key={r.p.id}>
                    <Td className="font-medium">{r.clientName}</Td>
                    <Td>{labelOf(SOCIAL_NETWORKS, r.p.network)}{r.p.scheduledTime && <div className="text-xs text-slate-500">{r.p.scheduledTime.slice(0, 5)}</div>}</Td>
                    <Td>{r.p.contentTitle}{r.fileUrl && <div><a className="text-xs text-brand-700 underline" href={r.fileUrl} target="_blank" rel="noreferrer">Archivo final</a></div>}</Td>
                    <Td>{r.responsible ?? "—"}</Td>
                    <Td><StatusBadge list={PUBLICATION_STATUSES} value={r.p.status} /></Td>
                    <Td className="text-xs">{r.p.confirmedAt ? <>Confirmada {formatDateTime(r.p.confirmedAt)} ({r.p.verification}){r.p.evidenceUrl && <div><a className="text-brand-700 underline" href={r.p.evidenceUrl} target="_blank" rel="noreferrer">Evidencia</a></div>}</> : "—"}</Td>
                    <Td className="min-w-64">
                      {editable(r.p) && r.p.status !== "reprogramada" ? (
                        <div className="space-y-1">
                          <ActionForm action={updatePublicationAction} className="space-y-1">
                            <input type="hidden" name="id" value={r.p.id} />
                            <div className="flex gap-1"><Select name="status" defaultValue={r.p.status} className="h-8 text-xs">{PUBLICATION_STATUSES.filter((s) => s.value !== "reprogramada").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select><SubmitButton size="sm" variant="secondary">Guardar</SubmitButton></div>
                            <Input name="evidenceUrl" placeholder="Enlace o evidencia" defaultValue={r.p.evidenceUrl ?? ""} className="h-8 text-xs" />
                          </ActionForm>
                          {!["publicada", "no_aplica"].includes(r.p.status) && (
                            <ActionForm action={reschedulePublicationAction} inline><input type="hidden" name="id" value={r.p.id} /><Input type="date" name="scheduledDate" required className="h-8 w-36 text-xs" /><SubmitButton size="sm" variant="ghost">Reprogramar</SubmitButton></ActionForm>
                          )}
                        </div>
                      ) : <span className="text-xs text-slate-400">{r.p.status === "reprogramada" ? "Ver nueva fecha" : "Solo lectura"}</span>}
                    </Td>
                  </tr>
                ))}</tbody>
              </Table>
            ) : <div className="p-4"><Empty>No hay publicaciones previstas para este día. Los clientes sin publicación prevista no cuentan como incumplimiento.</Empty></div>}
          </Card>
          {(d.manage || d.own) && (
            <Card title="Planificar publicación" className="mt-4">
              <ActionForm action={createPublicationAction} resetOnSuccess>
                <div className="grid gap-3 sm:grid-cols-5">
                  <Field label="Cliente"><Select name="clientId" required>{D.clients.map((c: Any) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select></Field>
                  <Field label="Red"><Select name="network">{SOCIAL_NETWORKS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}</Select></Field>
                  <Field label="Fecha"><Input type="date" name="scheduledDate" required defaultValue={d.day} /></Field>
                  <Field label="Hora"><Input type="time" name="scheduledTime" /></Field>
                  <Field label="Estado"><Select name="status"><option value="pendiente">Pendiente</option><option value="lista_programar">Lista para programar</option><option value="programada">Programada</option></Select></Field>
                </div>
                <Field label="Contenido"><Input name="contentTitle" required placeholder="Reel 1: …" /></Field>
                <SubmitButton size="sm">Planificar</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </>
      )}

      {tab === "contenido" && (
        <Card title="Contenido terminado (tableros al 100 %)" padded={false}>
          {D.content.length ? (
            <Table>
              <thead><tr><Th>Cliente</Th><Th>Mes</Th><Th>Entregable</Th><Th>Archivo final</Th><Th>Publicaciones</Th></tr></thead>
              <tbody>{D.content.map((c: Any) => (
                <tr key={c.id}>
                  <Td>{c.clientName}</Td><Td>{formatPeriod(c.period)}</Td>
                  <Td><Link href={`/produccion/${c.boardId}`} className="hover:underline">{c.title}</Link> <StatusBadge list={c.kind === "reel" ? VIDEO_STATUSES : DESIGN_STATUSES} value={c.status} /></Td>
                  <Td>{c.finalFileUrl ? <a className="text-brand-700 underline" href={c.finalFileUrl} target="_blank" rel="noreferrer">Abrir</a> : "—"}</Td>
                  <Td className="space-x-1">{c.publications.length ? c.publications.map((p: Any, i: number) => <Badge key={i} tone={p.status === "publicada" ? "green" : "gray"}>{labelOf(SOCIAL_NETWORKS, p.network)} · {formatDate(p.date)}</Badge>) : <Badge tone="yellow">Sin programar</Badge>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          ) : <div className="p-4"><Empty>Aún no hay tableros completos. Cuando Diseño y Video terminen todo el paquete, el contenido aparecerá aquí.</Empty></div>}
        </Card>
      )}

      {tab === "historial" && (
        <>
          <form className="mb-4 flex flex-wrap gap-2">
            <input type="hidden" name="tab" value="historial" />
            <Field label="Desde"><Input type="date" name="desde" defaultValue={D.from} /></Field>
            <Field label="Hasta"><Input type="date" name="hasta" defaultValue={D.to} /></Field>
            <Field label="Agrupar"><Select name="agrupar" defaultValue={sp(q.agrupar) ?? "day"}><option value="day">Por día</option><option value="week">Por semana</option><option value="month">Por mes</option></Select></Field>
            <Field label="Alcance"><Select name="alcance" defaultValue={sp(q.alcance) ?? "total"}><option value="total">Toda la agencia</option>{SOCIAL_NETWORKS.map((n) => <option key={n.value} value={`network:${n.value}`}>{n.label}</option>)}{D.employees.map((e: Any) => <option key={e.id} value={`cm:${e.id}`}>CM: {e.fullName}</option>)}{D.clients.map((c: Any) => <option key={c.id} value={`client:${c.id}`}>Cliente: {c.tradeName}</option>)}</Select></Field>
            <div className="flex items-end"><button className="h-9 rounded-md border px-3 text-sm">Ver</button></div>
          </form>
          <Card padded={false}>
            {D.history.length ? (
              <Table>
                <thead><tr><Th>Período</Th><Th>Días</Th><Th>Previstas</Th><Th>Publicadas</Th><Th>Fallidas</Th><Th className="w-48">Cumplimiento</Th><Th>Clientes que cumplieron</Th></tr></thead>
                <tbody>{D.history.map((h: Any) => (
                  <tr key={h.key}><Td>{h.key.length === 7 ? formatPeriod(h.key + "-01") : sp(q.agrupar) === "week" ? `Semana del ${formatDate(h.key)}` : formatDate(h.key, { withWeekday: true })}</Td><Td>{h.days}</Td><Td>{h.planned}</Td><Td>{h.published}</Td><Td>{h.failed}</Td><Td><div className="flex items-center gap-2"><Progress value={h.ratio ?? 0} /><span className="text-xs tabular">{h.ratio === null ? "—" : formatPercent(h.ratio)}</span></div></Td><Td>{h.clientsCompliant}/{h.clientsPlanned}</Td></tr>
                ))}</tbody>
              </Table>
            ) : <div className="p-4"><Empty>Sin datos en este rango.</Empty></div>}
          </Card>
        </>
      )}
    </>
  );
}

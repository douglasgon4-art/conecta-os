import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { getSession, listSessions, sessionsNeedingAttention } from "@/server/services/sessions";
import { listClients } from "@/server/services/clients";
import { listAssignableEmployees } from "@/server/services/employees";
import { Badge, Card, Empty, Field, Input, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SESSION_STATUSES, labelOf } from "@/lib/domain";
import { addDays, addMonths, firstOfMonth, formatDate, formatDateTime, formatPeriod, lastOfMonth, startOfWeek } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { cancelSessionAction, completeSessionAction, scheduleSessionAction, updateSessionAction } from "./actions";

export const metadata = { title: "Agenda de sesiones" };
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const toneBg: Record<string, string> = { green: "border-emerald-300 bg-emerald-50", yellow: "border-amber-300 bg-amber-50", red: "border-red-300 bg-red-50", gray: "border-slate-200 bg-slate-50", blue: "border-sky-300 bg-sky-50" };

export default async function AgendaPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const view = sp(q.vista) ?? "mes";
  const d = await load(["sessions.read"], async (ctx) => {
    const ref = sp(q.fecha) ?? ctx.today;
    const [from, to] = view === "dia" ? [ref, ref] : view === "semana" ? [startOfWeek(ref), addDays(startOfWeek(ref), 6)] : [startOfWeek(firstOfMonth(ref)), addDays(startOfWeek(lastOfMonth(ref)), 6)];
    return {
      ref,
      from,
      to,
      sessions: await listSessions(ctx, { from, to, clientId: sp(q.cliente), responsibleId: sp(q.responsable), status: sp(q.estado) }),
      attention: await sessionsNeedingAttention(ctx),
      selected: sp(q.sesion) ? await getSession(ctx, sp(q.sesion)!) : null,
      clients: await listClients(ctx, { scope: "operativos" }),
      employees: await listAssignableEmployees(ctx),
      canWrite: can(ctx, "sessions.write"),
      today: ctx.today,
    };
  });
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const cur = { vista: view, fecha: d.ref, cliente: sp(q.cliente), responsable: sp(q.responsable), estado: sp(q.estado), ...patch };
    Object.entries(cur).forEach(([k, v]) => v && p.set(k, v));
    return `/agenda?${p}`;
  };
  const step = view === "dia" ? 1 : view === "semana" ? 7 : 0;
  const prev = step ? addDays(d.ref, -step) : addMonths(firstOfMonth(d.ref), -1);
  const next = step ? addDays(d.ref, step) : addMonths(firstOfMonth(d.ref), 1);
  const days: string[] = [];
  for (let x = d.from; x <= d.to; x = addDays(x, 1)) days.push(x);
  const byDay = (day: string) => d.sessions.filter((s) => s.date === day);
  const s = d.selected;

  return (
    <>
      <PageHeader title="Agenda de sesiones" subtitle="Fecha prevista, propuesta, confirmada y realizada se registran por separado" />
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card padded={false}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
              <Link href={qs({ fecha: prev })} className="rounded-md border px-2 py-1 text-sm" aria-label="Anterior">‹</Link>
              <Link href={qs({ fecha: d.today })} className="rounded-md border px-2 py-1 text-sm">Hoy</Link>
              <Link href={qs({ fecha: next })} className="rounded-md border px-2 py-1 text-sm" aria-label="Siguiente">›</Link>
              <span className="ml-1 font-semibold capitalize">{view === "mes" ? formatPeriod(d.ref) : view === "semana" ? `Semana del ${formatDate(d.from)}` : formatDate(d.ref, { withWeekday: true })}</span>
              <div className="ml-auto flex gap-1">
                {[["mes", "Mes"], ["semana", "Semana"], ["dia", "Día"]].map(([k, l]) => <Link key={k} href={qs({ vista: k })} className={cn("rounded-md px-2.5 py-1 text-sm", view === k ? "bg-brand-600 text-white" : "border")}>{l}</Link>)}
              </div>
            </div>
            <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
              <input type="hidden" name="vista" value={view} /><input type="hidden" name="fecha" value={d.ref} />
              <Select name="cliente" defaultValue={sp(q.cliente) ?? ""} className="max-w-48"><option value="">Todos los clientes</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select>
              <Select name="responsable" defaultValue={sp(q.responsable) ?? ""} className="max-w-48"><option value="">Todos los responsables</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select>
              <Select name="estado" defaultValue={sp(q.estado) ?? ""} className="max-w-48"><option value="">Todos los estados</option>{SESSION_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>
              <button className="h-9 rounded-md border px-3 text-sm">Filtrar</button>
            </form>
            {view === "dia" ? (
              <div className="space-y-2 p-3">{byDay(d.ref).length ? byDay(d.ref).map((x) => <SessionChip key={x.id} s={x} href={qs({ sesion: x.id })} large />) : <Empty>Sin sesiones este día.</Empty>}</div>
            ) : (
              <div className="grid grid-cols-7 text-xs">
                {WEEKDAYS.map((w) => <div key={w} className="border-b border-slate-100 bg-slate-50 p-2 font-semibold text-slate-500">{w}</div>)}
                {days.map((day) => (
                  <div key={day} className={cn("border-b border-r border-slate-100 p-1.5", view === "semana" ? "min-h-48" : "min-h-24", day.slice(0, 7) !== d.ref.slice(0, 7) && view === "mes" && "bg-slate-50/60 text-slate-400")}>
                    <Link href={qs({ vista: "dia", fecha: day })} className={cn("mb-1 inline-block rounded px-1", day === d.today && "bg-brand-600 font-bold text-white")}>{Number(day.slice(8))}</Link>
                    <div className="space-y-1">{byDay(day).map((x) => <SessionChip key={x.id} s={x} href={qs({ sesion: x.id })} />)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-3 p-3 text-xs text-slate-600">
              <Badge tone="green">Confirmada</Badge><Badge tone="yellow">Coordinar pronto / en coordinación</Badge><Badge tone="red">Atrasada, sin confirmar o vencida</Badge><Badge tone="gray">Prevista</Badge>
              <span>⚠ = conflicto de horario del responsable</span>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          {s && (
            <Card title={`Sesión · ${s.clientName}`} actions={<Link href={qs({ sesion: undefined })} className="text-xs">Cerrar</Link>}>
              <div className="mb-3 space-y-1 text-sm">
                <StatusBadge list={SESSION_STATUSES} value={s.status} /> <Badge tone={s.alert.tone}>{s.alert.label}</Badge>
                <div>Prevista: <strong>{formatDate(s.expectedDate)}</strong> · coordinar desde {formatDate(s.coordinationStartDate)}</div>
                <div>Propuesta: {formatDate(s.proposedDate)} · Confirmada: {formatDate(s.confirmedDate)} {s.startTime?.slice(0, 5)}{s.endTime && `–${s.endTime.slice(0, 5)}`}</div>
                <div>Realizada: {formatDate(s.completedDate)}</div>
                <div>Responsable: {s.responsible ?? "—"} · Lugar: {s.location ?? "—"} · Contacto: {s.clientContact ?? "—"}</div>
                <Link className="text-brand-700 underline" href={`/clientes/${s.clientId}?tab=agenda`}>Historial del cliente</Link>
              </div>
              {d.canWrite && !["realizada", "cancelada"].includes(s.status) && (
                <div className="space-y-4">
                  <ActionForm action={updateSessionAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <Field label="Estado de coordinación"><Select name="status" defaultValue={s.status}>{SESSION_STATUSES.filter((x) => !["realizada", "cancelada"].includes(x.value)).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Fecha propuesta"><Input type="date" name="proposedDate" defaultValue={s.proposedDate ?? ""} /></Field>
                      <Field label="Fecha confirmada"><Input type="date" name="confirmedDate" defaultValue={s.confirmedDate ?? ""} /></Field>
                      <Field label="Inicio"><Input type="time" name="startTime" defaultValue={s.startTime?.slice(0, 5) ?? ""} /></Field>
                      <Field label="Fin"><Input type="time" name="endTime" defaultValue={s.endTime?.slice(0, 5) ?? ""} /></Field>
                    </div>
                    <Field label="Responsable"><Select name="responsibleId" defaultValue={s.responsibleId ?? ""}><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
                    <Field label="Ubicación"><Input name="location" defaultValue={s.location ?? ""} /></Field>
                    <Field label="Contacto del cliente"><Input name="clientContact" defaultValue={s.clientContact ?? ""} /></Field>
                    <Field label="Observaciones"><Textarea name="notes" defaultValue={s.notes ?? ""} rows={2} /></Field>
                    <Field label="Nota para el historial"><Input name="note" /></Field>
                    <SubmitButton className="w-full">Guardar</SubmitButton>
                  </ActionForm>
                  <ActionForm action={completeSessionAction} className="rounded-lg border border-emerald-200 p-3">
                    <input type="hidden" name="id" value={s.id} />
                    <Field label="Registrar como realizada el"><Input type="date" name="completedDate" required max={d.today} defaultValue={s.confirmedDate && s.confirmedDate <= d.today ? s.confirmedDate : d.today} /></Field>
                    <SubmitButton variant="secondary" size="sm">Registrar sesión realizada</SubmitButton>
                  </ActionForm>
                  <ActionForm action={cancelSessionAction} className="rounded-lg border border-red-200 p-3">
                    <input type="hidden" name="id" value={s.id} />
                    <Field label="Motivo de cancelación"><Input name="reason" required /></Field>
                    <SubmitButton variant="danger" size="sm">Cancelar sesión</SubmitButton>
                  </ActionForm>
                </div>
              )}
              <h3 className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Historial de cambios</h3>
              <ol className="space-y-1 text-xs">{s.events.map((e) => <li key={e.id}><span className="text-slate-500">{formatDateTime(e.createdAt)}</span> · {e.fromStatus && `${labelOf(SESSION_STATUSES, e.fromStatus)} → `}{labelOf(SESSION_STATUSES, e.toStatus)}{e.note && ` · ${e.note}`}</li>)}</ol>
            </Card>
          )}
          <Card title={`Requieren atención (${d.attention.length})`}>
            {d.attention.length ? (
              <ul className="space-y-2">{d.attention.map((a) => (
                <li key={a.id}><Link href={qs({ sesion: a.id })} className="block rounded-md p-1.5 text-sm hover:bg-slate-50"><div className="font-medium">{a.clientName}</div><Badge tone={a.alert.tone}>{a.alert.label}</Badge></Link></li>
              ))}</ul>
            ) : <Empty>Todo al día.</Empty>}
          </Card>
          {d.canWrite && (
            <Card title="Programar sesión">
              <ActionForm action={scheduleSessionAction} resetOnSuccess>
                <Field label="Cliente"><Select name="clientId" required>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select></Field>
                <div className="grid grid-cols-2 gap-2"><Field label="Fecha"><Input type="date" name="date" required /></Field><Field label="Hora"><Input type="time" name="startTime" /></Field></div>
                <Field label="Responsable"><Select name="responsibleId" defaultValue=""><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
                <Field label="Ubicación"><Input name="location" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmed" defaultChecked className="size-4" />El cliente ya confirmó la fecha</label>
                <SubmitButton className="w-full">Programar</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function SessionChip({ s, href, large }: { s: { id: string; clientName: string; status: string; startTime: string | null; alert: { tone: string; label: string }; conflicts: string[] }; href: string; large?: boolean }) {
  return (
    <Link href={href} title={s.alert.label} className={cn("block truncate rounded border px-1.5 py-0.5", toneBg[s.alert.tone], large && "p-3 text-sm")}>
      {s.conflicts.length > 0 && <span aria-label="Conflicto de horario">⚠ </span>}
      {s.startTime && <span className="tabular">{s.startTime.slice(0, 5)} </span>}
      <span className="font-medium">{s.clientName}</span>
      {large && <div className="text-xs text-slate-600">{labelOf(SESSION_STATUSES, s.status)} · {s.alert.label}</div>}
    </Link>
  );
}

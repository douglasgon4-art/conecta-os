import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { LEAD_LISTS, leadListCounts, listLeads } from "@/server/services/leads";
import { can } from "@/server/ctx";
import { Badge, Card, Empty, Field, Input, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { LEAD_STATUSES } from "@/lib/domain";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { createLeadAction } from "./actions";

export const metadata = { title: "Ventas" };

export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const list = sp(q.lista) ?? (sp(q.q) ? undefined : "hoy");
  const d = await load(["leads.read"], async (ctx) => ({
    counts: await leadListCounts(ctx),
    rows: await listLeads(ctx, { list, q: sp(q.q) }),
    canWrite: can(ctx, "leads.write"),
    today: ctx.today,
  }));
  return (
    <>
      <PageHeader title="Ventas y prospectos" subtitle="Las listas se actualizan solas según el estado de cada prospecto" />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <div className="space-y-4">
          <Card padded={false}>
            <nav className="p-2" aria-label="Listas de trabajo">
              {Object.entries(LEAD_LISTS).map(([key, def]) => (
                <Link key={key} href={`/ventas?lista=${key}`} className={cn("flex items-center justify-between rounded-md px-2 py-1.5 text-sm", list === key ? "bg-brand-50 font-medium text-brand-700" : "hover:bg-slate-50")}>
                  {def.label}<span className="rounded-full bg-slate-100 px-2 text-xs tabular">{d.counts[key]}</span>
                </Link>
              ))}
            </nav>
          </Card>
          {d.canWrite && (
            <Card title="Agregar prospecto">
              <ActionForm action={createLeadAction} resetOnSuccess>
                <Field label="Negocio *"><Input name="tradeName" required /></Field>
                <Field label="Contacto"><Input name="contactName" /></Field>
                <Field label="Teléfono"><Input name="phone" /></Field>
                <Field label="Ciudad"><Input name="city" /></Field>
                <Field label="Tipo de negocio"><Input name="businessType" placeholder="Clínica, restaurante…" /></Field>
                <Field label="Fuente"><Input name="source" placeholder="Referido, Instagram…" /></Field>
                <Field label="Próximo seguimiento"><Input type="date" name="nextFollowupAt" /></Field>
                <SubmitButton className="w-full">Agregar a pendientes</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        <Card padded={false} title={list ? LEAD_LISTS[list]?.label : `Resultados para "${sp(q.q)}"`} actions={<form><Input name="q" placeholder="Buscar…" defaultValue={sp(q.q)} className="h-8 w-48" /></form>}>
          {d.rows.length ? (
            <Table>
              <thead><tr><Th>Negocio</Th><Th>Estado</Th><Th>Próxima acción</Th><Th>Seguimiento</Th><Th>Agente</Th></tr></thead>
              <tbody>
                {d.rows.map(({ lead, owner }) => (
                  <tr key={lead.id} className="hover:bg-slate-50">
                    <Td><Link href={`/ventas/${lead.id}`} className="font-medium hover:underline">{lead.tradeName}</Link><div className="text-xs text-slate-500">{[lead.city, lead.phone].filter(Boolean).join(" · ")}</div></Td>
                    <Td><StatusBadge list={LEAD_STATUSES} value={lead.status} /></Td>
                    <Td>{lead.nextAction ?? "—"}</Td>
                    <Td>{lead.nextFollowupAt ? <Badge tone={lead.nextFollowupAt < d.today ? "red" : lead.nextFollowupAt === d.today ? "yellow" : "gray"}>{formatDate(lead.nextFollowupAt)}</Badge> : "—"}</Td>
                    <Td>{owner ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <div className="p-4"><Empty>No hay prospectos en esta lista.</Empty></div>}
        </Card>
      </div>
    </>
  );
}

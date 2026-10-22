import Link from "next/link";
import { load } from "../../_lib/page";
import { getLead } from "@/server/services/leads";
import { listPackages, searchClients } from "@/server/services/clients";
import { listAssignableEmployees } from "@/server/services/employees";
import { can } from "@/server/ctx";
import { Badge, Card, DL, Empty, Field, Input, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ContractFields } from "@/components/forms/contract-fields";
import { CALL_RESULTS, CLOSED_LEAD_STATUSES, INTEREST_LEVELS, LEAD_STATUSES, labelOf } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { convertLeadAction, logCallAction, loseLeadAction, proposalAction, updateLeadAction } from "../actions";

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(["leads.read"], async (ctx) => {
    const lead = await getLead(ctx, id);
    return {
      lead,
      canWrite: can(ctx, "leads.write"),
      canConvert: can(ctx, "leads.convert"),
      packages: await listPackages(ctx),
      employees: await listAssignableEmployees(ctx),
      similarClients: await searchClients(ctx, lead.tradeName, 5),
      today: ctx.today,
    };
  });
  const l = d.lead;
  const closed = CLOSED_LEAD_STATUSES.includes(l.status as never);
  return (
    <>
      <PageHeader title={l.tradeName} subtitle={<span className="flex items-center gap-2"><StatusBadge list={LEAD_STATUSES} value={l.status} />{l.client && <Link href={`/clientes/${l.client.id}`} className="text-brand-700 underline">Ver cliente</Link>}</span>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Ficha del prospecto">
            <DL items={[["Contacto", l.contactName], ["Teléfono", l.phone], ["Correo", l.email], ["Ubicación", [l.address, l.city, l.country].filter(Boolean).join(", ")], ["Tipo de negocio", l.businessType], ["Fuente", l.source], ["Agente", l.owner], ["Creado", formatDateTime(l.createdAt)], ["Último contacto", formatDateTime(l.lastContactAt)], ["Próximo seguimiento", formatDate(l.nextFollowupAt)], ["Próxima acción", l.nextAction], ["Notas", l.notes]]} />
          </Card>
          <Card title={`Historial de llamadas (${l.calls.length})`}>
            {l.calls.length ? (
              <ol className="space-y-3">
                {l.calls.map((c) => (
                  <li key={c.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">{formatDateTime(c.calledAt)} · {c.agent ?? "—"} · {c.channel}<Badge tone={c.result === "contesto" ? "green" : "yellow"}>{labelOf(CALL_RESULTS, c.result)}</Badge>{c.interestLevel && <Badge tone="blue">Interés {labelOf(INTEREST_LEVELS, c.interestLevel)}</Badge>}</div>
                    {c.answeredBy && <div>Contestó: {c.answeredBy}</div>}
                    {c.response && <div>Respuesta: {c.response}</div>}
                    {c.objections && <div>Objeciones: {c.objections}</div>}
                    {c.notes && <div className="text-slate-600">{c.notes}</div>}
                    {(c.nextAction || c.nextFollowupAt) && <div className="text-xs text-slate-500">Siguiente: {c.nextAction} {c.nextFollowupAt && `(${formatDate(c.nextFollowupAt)})`}</div>}
                  </li>
                ))}
              </ol>
            ) : <Empty>Aún no hay llamadas registradas.</Empty>}
          </Card>
          {d.canConvert && !closed && (
            <Card title="Venta ganada: convertir en cliente">
              {d.similarClients.length > 0 && (
                <div className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900">Clientes con nombre parecido: {d.similarClients.map((c) => c.tradeName).join(", ")}. Si es el mismo, vincúlalo abajo para no duplicarlo.</div>
              )}
              <ActionForm action={convertLeadAction}>
                <input type="hidden" name="leadId" value={l.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Vincular a cliente existente"><Select name="linkClientId" defaultValue=""><option value="">— Crear cliente nuevo —</option>{d.similarClients.map((c) => <option key={c.id} value={c.id}>{c.tradeName} ({c.status})</option>)}</Select></Field>
                  <Field label="Responsable de la cuenta"><Select name="accountManagerId" defaultValue=""><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
                  <Field label="Community Manager"><Select name="communityManagerId" defaultValue=""><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
                </div>
                <ContractFields packages={d.packages} value={{ startDate: d.today, monthlyPrice: l.proposals[0]?.monthlyPrice, currency: l.proposals[0]?.currency }} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowDuplicate" className="size-4" />Confirmo que no es un cliente existente (omitir aviso de duplicado)</label>
                <SubmitButton>Marcar venta ganada y crear cliente</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {d.canWrite && !closed && (
            <Card title="Registrar llamada">
              <ActionForm action={logCallAction} resetOnSuccess>
                <input type="hidden" name="leadId" value={l.id} />
                <Field label="Resultado *"><Select name="result" required>{CALL_RESULTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
                <Field label="Canal"><Select name="channel"><option value="llamada">Llamada</option><option value="whatsapp">WhatsApp</option><option value="reunion">Reunión</option><option value="correo">Correo</option><option value="visita">Visita</option></Select></Field>
                <Field label="Fecha y hora"><Input type="datetime-local" name="calledAt" /></Field>
                <Field label="Persona que contestó"><Input name="answeredBy" /></Field>
                <Field label="Respuesta del prospecto"><Textarea name="response" rows={2} /></Field>
                <Field label="Interés"><Select name="interestLevel" defaultValue=""><option value="">—</option>{INTEREST_LEVELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
                <Field label="Objeciones"><Input name="objections" /></Field>
                <Field label="Notas"><Textarea name="notes" rows={2} /></Field>
                <Field label="Nuevo estado"><Select name="statusAfter" defaultValue=""><option value="">Automático</option>{LEAD_STATUSES.filter((s) => s.value !== "venta_ganada").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
                <Field label="Próxima acción"><Input name="nextAction" /></Field>
                <Field label="Fecha de seguimiento"><Input type="date" name="nextFollowupAt" /></Field>
                <SubmitButton className="w-full">Guardar llamada</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {d.canWrite && (
            <Card title="Editar prospecto">
              <ActionForm action={updateLeadAction}>
                <input type="hidden" name="id" value={l.id} />
                <Field label="Estado"><Select name="status" defaultValue={l.status}>{LEAD_STATUSES.filter((s) => s.value !== "venta_ganada" || l.status === "venta_ganada").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
                <Field label="Contacto"><Input name="contactName" defaultValue={l.contactName ?? ""} /></Field>
                <Field label="Teléfono"><Input name="phone" defaultValue={l.phone ?? ""} /></Field>
                <Field label="Correo"><Input name="email" defaultValue={l.email ?? ""} /></Field>
                <Field label="Ciudad"><Input name="city" defaultValue={l.city ?? ""} /></Field>
                <Field label="Agente"><Select name="ownerId" defaultValue={l.ownerId ?? ""}><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
                <Field label="Notas"><Textarea name="notes" defaultValue={l.notes ?? ""} rows={2} /></Field>
                <SubmitButton variant="secondary" className="w-full">Guardar</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title="Propuestas">
            {l.proposals.map((p) => <div key={p.id} className="mb-2 text-sm"><strong>{p.title}</strong> · {formatMoney(p.monthlyPrice, p.currency)}/mes · {p.sentAt ? `enviada ${formatDate(p.sentAt)}` : "borrador"}</div>)}
            {d.canWrite && !closed && (
              <ActionForm action={proposalAction} resetOnSuccess>
                <input type="hidden" name="leadId" value={l.id} />
                <Field label="Título"><Input name="title" required defaultValue="Propuesta paquete estándar" /></Field>
                <div className="grid grid-cols-2 gap-2"><Field label="Precio mensual"><Input name="monthlyPrice" required /></Field><Field label="Moneda"><Select name="currency"><option value="NIO">C$</option><option value="USD">US$</option></Select></Field></div>
                <Field label="Fecha de envío"><Input type="date" name="sentAt" /></Field>
                <SubmitButton variant="secondary" size="sm">Registrar propuesta</SubmitButton>
              </ActionForm>
            )}
          </Card>
          {d.canWrite && !closed && (
            <Card title="Cerrar sin venta">
              <ActionForm action={loseLeadAction}>
                <input type="hidden" name="leadId" value={l.id} />
                <Field label="Resultado"><Select name="status"><option value="venta_perdida">Venta perdida</option><option value="no_interesado">No interesado</option><option value="no_necesita">No necesita el servicio</option></Select></Field>
                <Field label="Motivo"><Input name="reason" /></Field>
                <SubmitButton variant="secondary" size="sm">Cerrar prospecto</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

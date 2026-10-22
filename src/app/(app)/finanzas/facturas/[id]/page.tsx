import Link from "next/link";
import { load } from "../../../_lib/page";
import { can } from "@/server/ctx";
import { getInvoice } from "@/server/services/invoices";
import { Card, DL, Field, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { INVOICE_STATUSES, PAYMENT_METHODS, labelOf } from "@/lib/domain";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { invoicePaymentAction, voidInvoiceAction } from "../../actions";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(["finance.read"], async (ctx) => ({ i: await getInvoice(ctx, id), pay: can(ctx, "invoices.pay"), void: can(ctx, "invoices.void"), today: ctx.today }));
  const i = d.i;
  return (
    <>
      <PageHeader title={`Factura ${i.number}`} subtitle={<span className="flex items-center gap-2"><StatusBadge list={INVOICE_STATUSES} value={i.status} /><Link className="text-brand-700 underline" href={`/clientes/${i.clientId}?tab=facturacion`}>{i.clientName}</Link></span>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Detalle" className="lg:col-span-2">
          <DL items={[["Concepto", i.concept], ["Período de servicio", i.period ? formatPeriod(i.period) : "—"], ["Emisión", formatDate(i.issueDate)], ["Vencimiento", formatDate(i.dueDate)], ["Importe", formatMoney(i.amount, i.currency)], ["Pagado", formatMoney(i.paidAmount, i.currency)], ["Saldo pendiente", formatMoney(i.balance, i.currency)], ["Origen", i.sourceKey ? "Generada por contrato" : "Manual"], ...(i.voidedAt ? [["Anulada", `${formatDateTime(i.voidedAt)} · ${i.voidReason}`] as [string, string]] : [])]} />
          <h3 className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Cobros</h3>
          {i.payments.length ? (
            <Table><thead><tr><Th>Fecha</Th><Th>Importe</Th><Th>Método</Th><Th>Referencia</Th></tr></thead><tbody>{i.payments.map((p) => <tr key={p.id}><Td>{formatDate(p.paidAt)}</Td><Td className="tabular">{formatMoney(p.amount, p.currency)}</Td><Td>{labelOf(PAYMENT_METHODS, p.method)}</Td><Td>{p.reference ?? "—"}</Td></tr>)}</tbody></Table>
          ) : <p className="text-sm text-slate-500">Sin cobros registrados.</p>}
        </Card>
        <div className="space-y-4">
          {d.pay && i.balance > 0 && i.status !== "anulada" && (
            <Card title="Registrar cobro">
              <ActionForm action={invoicePaymentAction}>
                <input type="hidden" name="id" value={i.id} />
                <Field label={`Importe (saldo ${formatMoney(i.balance, i.currency)})`}><Input name="amount" required inputMode="decimal" defaultValue={i.balance} /></Field>
                <Field label="Fecha"><Input type="date" name="paidAt" required defaultValue={d.today} /></Field>
                <Field label="Método"><Select name="method">{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
                <Field label="Referencia"><Input name="reference" /></Field>
                <input type="hidden" name="idempotencyKey" value={`ui:${i.id}:${i.payments.length}`} />
                <SubmitButton className="w-full">Registrar cobro</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {d.void && i.status !== "anulada" && i.paidAmount === 0 && (
            <Card title="Anular factura">
              <ActionForm action={voidInvoiceAction}>
                <input type="hidden" name="id" value={i.id} />
                <Field label="Motivo"><Input name="reason" required /></Field>
                <SubmitButton variant="danger" size="sm">Anular</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { load, sp, type SP } from "../../_lib/page";
import { can } from "@/server/ctx";
import { getPayroll } from "@/server/services/payroll";
import { Badge, Card, DL, Field, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PAYROLL_STATUSES } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { adjustmentAction, approvePayrollAction, payPayrollAction, postPayrollAction, recalcPayrollAction } from "../actions";

export default async function PayrollDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const q = await searchParams;
  const d = await load(["payroll.read"], async (ctx) => ({ p: await getPayroll(ctx, id), write: can(ctx, "payroll.write"), approve: can(ctx, "payroll.approve"), today: ctx.today }));
  const p = d.p;
  const m = (v: number) => formatMoney(v, p.records[0]?.currency ?? "NIO");
  const slip = sp(q.recibo) ? p.records.find((r) => r.employeeId === sp(q.recibo)) : null;
  return (
    <>
      <PageHeader title={`Nómina ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`} subtitle={<span className="flex items-center gap-2"><StatusBadge list={PAYROLL_STATUSES} value={p.status} />{p.isEstimate ? <Badge tone="yellow">Estimación administrativa</Badge> : <Badge tone="green">Cálculo con reglas validadas</Badge>} Pago: {formatDate(p.payDate)} · Reglas {p.rules?.version}</span>}
        actions={<>
          {d.write && p.status === "borrador" && <ActionForm action={recalcPayrollAction} inline><input type="hidden" name="id" value={p.id} /><input type="hidden" name="periodStart" value={p.periodStart} /><input type="hidden" name="periodEnd" value={p.periodEnd} /><SubmitButton size="sm" variant="secondary">Recalcular</SubmitButton></ActionForm>}
          {d.approve && p.status === "borrador" && <ActionForm action={approvePayrollAction} inline><input type="hidden" name="id" value={p.id} /><SubmitButton size="sm">Aprobar nómina</SubmitButton></ActionForm>}
          {d.approve && p.status === "aprobada" && <ActionForm action={postPayrollAction} inline><input type="hidden" name="id" value={p.id} /><SubmitButton size="sm">Contabilizar</SubmitButton></ActionForm>}
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Salario bruto", p.totals.gross], ["Deducciones (INSS + IR + otras)", p.totals.inssEmployee + p.totals.incomeTax + p.totals.otherDeductions], ["Salario neto a pagar", p.totals.net], ["Aportes patronales (INSS + INATEC)", p.totals.inssEmployer + p.totals.inatec]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">{l}</div><div className="mt-1 text-xl font-semibold tabular">{m(v as number)}</div></div>
        ))}
      </div>
      <Card padded={false} title="Recibos por colaborador">
        <Table>
          <thead><tr><Th>Colaborador</Th><Th>Días</Th><Th>Salario base</Th><Th>Bruto</Th><Th>Otras percepciones</Th><Th>INSS laboral</Th><Th>IR</Th><Th>Otras deducciones</Th><Th>Neto</Th><Th>Patronal</Th><Th></Th></tr></thead>
          <tbody>{p.records.map((r) => (
            <tr key={r.id}><Td className="font-medium">{r.name}</Td><Td>{r.workedDays}</Td><Td className="tabular">{m(r.baseSalary)}</Td><Td className="tabular">{m(r.grossSalary)}</Td><Td className="tabular">{m(r.otherEarnings)}</Td><Td className="tabular">{m(r.inssEmployee)}</Td><Td className="tabular">{m(r.incomeTax)}</Td><Td className="tabular">{m(r.otherDeductions)}</Td><Td className="tabular font-semibold">{m(r.netSalary)}</Td><Td className="tabular">{m(r.inssEmployer + r.inatec)}</Td><Td><Link className="text-xs text-brand-700 underline" href={`/nomina/${p.id}?recibo=${r.employeeId}`}>Recibo</Link></Td></tr>
          ))}</tbody>
        </Table>
      </Card>
      {slip && (
        <Card title={`Recibo de pago · ${slip.name}`} className="mt-4">
          <DL items={[["Período", `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`], ["Fecha de pago", formatDate(p.payDate)], ["Días trabajados", slip.workedDays], ["Salario mensual base", m(slip.baseSalary)], ["Salario bruto de la quincena", m(slip.grossSalary)], ["Otras percepciones", m(slip.otherEarnings)], ["INSS laboral", m(slip.inssEmployee)], ["IR", m(slip.incomeTax)], ["Otras deducciones", m(slip.otherDeductions)], ["Total deducciones", m(slip.totalDeductions)], ["Salario neto", m(slip.netSalary)], ["Estado del pago", slip.payStatus === "pagado" ? `Pagado ${formatDate(slip.paidAt)}` : "Pendiente"]]} />
          <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Detalle del cálculo</summary><pre className="whitespace-pre-wrap">{JSON.stringify(slip.detail, null, 2)}</pre></details>
        </Card>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Ajustes autorizados">
          {p.adjustments.map((a) => <div key={a.id} className="text-sm">{a.type === "percepcion" ? "+" : "−"} {m(a.amount)} · {a.concept} · {p.records.find((r) => r.employeeId === a.employeeId)?.name} · {formatDateTime(a.createdAt)}</div>)}
          {d.write && p.status === "borrador" && (
            <ActionForm action={adjustmentAction} className="mt-3">
              <input type="hidden" name="id" value={p.id} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Colaborador"><Select name="employeeId">{p.records.map((r) => <option key={r.employeeId} value={r.employeeId}>{r.name}</option>)}</Select></Field>
                <Field label="Tipo"><Select name="type"><option value="percepcion">Percepción (bono, horas extra)</option><option value="deduccion">Deducción (adelanto, préstamo)</option></Select></Field>
                <Field label="Concepto"><Input name="concept" required /></Field>
                <Field label="Importe"><Input name="amount" required inputMode="decimal" /></Field>
              </div>
              <SubmitButton size="sm" variant="secondary">Agregar ajuste</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card title="Contabilización y pago">
          <p className="text-sm text-slate-600">Aprobada: {formatDateTime(p.approvedAt)} · Contabilizada: {formatDateTime(p.postedAt)}</p>
          <p className="mt-1 text-xs text-slate-500">Al contabilizar se generan en Gastos: salarios netos por pagar, retenciones laborales por enterar (INSS laboral + IR) y aportes patronales. Las provisiones de aguinaldo y vacaciones se registran aparte (no son salida de caja). Una nómina no puede contabilizarse dos veces.</p>
          {d.approve && p.status === "contabilizada" && (
            <ActionForm action={payPayrollAction} inline className="mt-3">
              <input type="hidden" name="id" value={p.id} />
              <Input type="date" name="paidAt" required defaultValue={d.today} />
              <Select name="method" className="w-40"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="cheque">Cheque</option><option value="deposito">Depósito</option></Select>
              <SubmitButton size="sm">Registrar pago de salarios</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}

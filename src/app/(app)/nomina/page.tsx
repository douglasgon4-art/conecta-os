import Link from "next/link";
import { load } from "../_lib/page";
import { can } from "@/server/ctx";
import { fortnightsOf, getRuleSet, listPayrolls } from "@/server/services/payroll";
import { addMonths, firstOfMonth, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, Card, Empty, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PAYROLL_STATUSES } from "@/lib/domain";
import { preparePayrollAction } from "./actions";

export const metadata = { title: "Nómina y prestaciones" };

export default async function PayrollPage() {
  const d = await load(["payroll.read"], async (ctx) => ({
    rows: await listPayrolls(ctx),
    rules: await getRuleSet(ctx, ctx.today).catch(() => null),
    write: can(ctx, "payroll.write"),
    periods: [...fortnightsOf(addMonths(firstOfMonth(ctx.today), -1)), ...fortnightsOf(ctx.today), ...fortnightsOf(addMonths(firstOfMonth(ctx.today), 1))],
  }));
  return (
    <>
      <PageHeader title="Nómina y prestaciones" subtitle="Nómina quincenal calculada con reglas laborales versionadas" />
      {d.rules ? (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${d.rules.validated ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          Reglas vigentes: <strong>{d.rules.version}</strong> desde {formatDate(d.rules.effectiveFrom)}. {d.rules.validated ? "Validadas contra fuentes oficiales." : "PENDIENTES DE VALIDACIÓN: los cálculos son estimaciones administrativas y no pueden aprobarse como nómina definitiva."} <Link className="underline" href="/configuracion/reglas-laborales">Ver reglas</Link>
        </div>
      ) : <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">No hay reglas laborales vigentes configuradas.</div>}
      {d.write && (
        <Card title="Preparar nómina quincenal" className="mb-4">
          <ActionForm action={preparePayrollAction} inline>
            <Select name="period" className="w-72">{d.periods.map((p) => <option key={p.periodStart} value={`${p.periodStart}|${p.periodEnd}`}>{formatDate(p.periodStart)} – {formatDate(p.periodEnd)} (pago {formatDate(p.payDate)})</option>)}</Select>
            <SubmitButton size="sm">Preparar / recalcular borrador</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card padded={false}>
        {d.rows.length ? (
          <Table>
            <thead><tr><Th>Período</Th><Th>Pago</Th><Th>Colaboradores</Th><Th>Neto a pagar</Th><Th>Tipo</Th><Th>Estado</Th></tr></thead>
            <tbody>{d.rows.map(({ p, net, n }) => (
              <tr key={p.id} className="hover:bg-slate-50"><Td><Link href={`/nomina/${p.id}`} className="font-medium hover:underline">{formatDate(p.periodStart)} – {formatDate(p.periodEnd)}</Link></Td><Td>{formatDate(p.payDate)}</Td><Td>{n}</Td><Td className="tabular">{formatMoney(net, "NIO")}</Td><Td>{p.isEstimate ? <Badge tone="yellow">Estimación</Badge> : <Badge tone="green">Definitiva</Badge>}</Td><Td><StatusBadge list={PAYROLL_STATUSES} value={p.status} /></Td></tr>
            ))}</tbody>
          </Table>
        ) : <div className="p-4"><Empty>Aún no hay nóminas.</Empty></div>}
      </Card>
    </>
  );
}

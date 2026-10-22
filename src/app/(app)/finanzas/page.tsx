import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { financialSummary } from "@/server/services/reports";
import { listInvoices } from "@/server/services/invoices";
import { Card, Empty, Input, PageHeader, Stat, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";
import { INVOICE_STATUSES } from "@/lib/domain";
import { formatDate, formatPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Finanzas" };
type M = { byCurrency: Record<string, number>; base: number } | null;

export default async function FinancePage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["finance.read"], async (ctx) => {
    const month = sp(q.mes) ?? ctx.today.slice(0, 7);
    return { month, s: await financialSummary(ctx, `${month}-01`), overdue: (await listInvoices(ctx, { status: "vencida" })).slice(0, 10) };
  });
  const s = d.s;
  const b = s.baseCurrency;
  const m = (x: M) => (x ? formatMoney(x.base, b) : "—");
  const detail = (x: M) => (x ? Object.entries(x.byCurrency).map(([c, v]) => formatMoney(v, c)).join(" + ") || "—" : undefined);
  return (
    <>
      <PageHeader title="Finanzas y cobros" subtitle={`${formatPeriod(s.period)} · equivalentes en ${b} (tipo de cambio ${s.exchangeRate})`} actions={<form><Input type="month" name="mes" defaultValue={d.month} className="w-44" /></form>} />
      <Tabs active="resumen" tabs={[{ key: "resumen", label: "Resumen", href: "/finanzas" }, { key: "facturas", label: "Cuentas por cobrar", href: "/finanzas/facturas" }, { key: "rentabilidad", label: "Rentabilidad por cliente", href: "/finanzas/rentabilidad" }]} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Stat label="Facturado (emitido en el mes)" value={m(s.invoiced)} hint={detail(s.invoiced)} />
        <Stat label="Ingreso reconocido (servicio del mes)" value={m(s.recognized)} hint={detail(s.recognized)} />
        <Stat label="Cobrado en el mes" value={m(s.collected)} hint={detail(s.collected)} tone="green" />
        <Stat label="Cuentas por cobrar (total)" value={m(s.receivable)} hint={detail(s.receivable)} href="/finanzas/facturas" />
        <Stat label="Cuentas vencidas" value={m(s.overdue)} tone={s.overdue.base ? "red" : undefined} href="/finanzas/facturas?estado=vencida" />
        {s.expenses && <Stat label="Gastos devengados del mes" value={m(s.expenses)} href="/gastos" />}
        {s.payables && <Stat label="Cuentas por pagar" value={m(s.payables)} />}
        {s.payroll && <Stat label="Nómina del mes" value={m(s.payroll)} href="/nomina" />}
        {s.cashOut && <Stat label="Salidas de caja" value={m(s.cashOut)} />}
        {s.netCashFlow !== null && <Stat label="Flujo de caja neto" value={formatMoney(s.netCashFlow, b)} hint="Cobrado − pagado en el mes" tone={s.netCashFlow < 0 ? "red" : "green"} />}
        {s.operatingResult !== null && <Stat label="Resultado operativo estimado" value={formatMoney(s.operatingResult, b)} hint="Ingreso reconocido − gastos devengados" tone={s.operatingResult < 0 ? "red" : "green"} />}
      </div>
      <Card title="Cobros vencidos" className="mt-4" padded={false}>
        {d.overdue.length ? (
          <Table><thead><tr><Th>Factura</Th><Th>Cliente</Th><Th>Venció</Th><Th>Saldo</Th><Th>Estado</Th></tr></thead>
            <tbody>{d.overdue.map((i) => <tr key={i.id}><Td><Link className="font-medium hover:underline" href={`/finanzas/facturas/${i.id}`}>{i.number}</Link></Td><Td>{i.clientName}</Td><Td>{formatDate(i.dueDate)}</Td><Td className="tabular">{formatMoney(i.balance, i.currency)}</Td><Td><StatusBadge list={INVOICE_STATUSES} value={i.status} /></Td></tr>)}</tbody>
          </Table>
        ) : <div className="p-4"><Empty>No hay cobros vencidos.</Empty></div>}
      </Card>
    </>
  );
}

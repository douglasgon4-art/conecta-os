import Link from "next/link";
import { load, sp, type SP } from "../../_lib/page";
import { clientProfitability } from "@/server/services/reports";
import { Badge, Card, Empty, Input, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { formatPeriod } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";

export const metadata = { title: "Rentabilidad por cliente" };

export default async function ProfitPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["finance.read"], async (ctx) => {
    const month = sp(q.mes) ?? ctx.today.slice(0, 7);
    return { month, r: await clientProfitability(ctx, `${month}-01`) };
  });
  const b = d.r.baseCurrency;
  return (
    <>
      <PageHeader title="Rentabilidad por cliente" subtitle={`${formatPeriod(d.r.period)} · regla de gastos generales: ${d.r.allocationRule === "ninguna" ? "no se asignan (configurable)" : "proporcional a ingresos"}`} actions={<form><Input type="month" name="mes" defaultValue={d.month} className="w-44" /></form>} />
      <Tabs active="rentabilidad" tabs={[{ key: "resumen", label: "Resumen", href: "/finanzas" }, { key: "facturas", label: "Cuentas por cobrar", href: "/finanzas/facturas" }, { key: "rentabilidad", label: "Rentabilidad por cliente", href: "/finanzas/rentabilidad" }]} />
      <Card padded={false}>
        {d.r.rows.length ? (
          <Table>
            <thead><tr><Th>Cliente</Th><Th>Ingreso reconocido</Th><Th>Cobrado en el mes</Th><Th>Costos directos</Th><Th>Gastos generales asignados</Th><Th>Margen estimado</Th><Th>Saldo pendiente</Th></tr></thead>
            <tbody>{d.r.rows.map((r) => (
              <tr key={r.clientId}><Td><Link className="font-medium hover:underline" href={`/clientes/${r.clientId}`}>{r.name}</Link></Td><Td className="tabular">{formatMoney(r.recognized, b)}</Td><Td className="tabular">{formatMoney(r.collected, b)}</Td><Td className="tabular">{formatMoney(r.directCosts, b)}</Td><Td className="tabular">{formatMoney(r.allocated, b)}</Td><Td><Badge tone={r.margin < 0 ? "red" : "green"} icon={false}>{formatMoney(r.margin, b)}{r.marginRatio !== null && ` (${formatPercent(r.marginRatio)})`}</Badge></Td><Td className="tabular">{formatMoney(r.pending, b)}</Td></tr>
            ))}</tbody>
          </Table>
        ) : <div className="p-4"><Empty>Sin datos para este mes.</Empty></div>}
      </Card>
      <p className="mt-3 text-xs text-slate-500">Gastos generales del mes sin cliente: {formatMoney(d.r.overhead, b)}. Los costos directos son gastos registrados con cliente relacionado.</p>
    </>
  );
}

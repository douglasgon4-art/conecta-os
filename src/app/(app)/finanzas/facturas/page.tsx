import Link from "next/link";
import { load, sp, type SP } from "../../_lib/page";
import { can } from "@/server/ctx";
import { listInvoices } from "@/server/services/invoices";
import { listClients } from "@/server/services/clients";
import { Card, Empty, Field, Input, PageHeader, Select, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { INVOICE_STATUSES } from "@/lib/domain";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createInvoiceAction } from "../actions";

export const metadata = { title: "Cuentas por cobrar" };

export default async function InvoicesPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["finance.read"], async (ctx) => ({
    rows: await listInvoices(ctx, { status: sp(q.estado) ?? "abiertas", clientId: sp(q.cliente), currency: sp(q.moneda) }),
    clients: await listClients(ctx, { scope: "todos" }),
    write: can(ctx, "invoices.write"),
    today: ctx.today,
  }));
  return (
    <>
      <PageHeader title="Cuentas por cobrar" subtitle="Las facturas mensuales de cada contrato se generan automáticamente; nunca se marcan como pagadas solas." />
      <Tabs active="facturas" tabs={[{ key: "resumen", label: "Resumen", href: "/finanzas" }, { key: "facturas", label: "Cuentas por cobrar", href: "/finanzas/facturas" }, { key: "rentabilidad", label: "Rentabilidad por cliente", href: "/finanzas/rentabilidad" }]} />
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <Card padded={false}>
          <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <Select name="estado" defaultValue={sp(q.estado) ?? "abiertas"} className="max-w-44"><option value="abiertas">Abiertas</option>{INVOICE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}<option value="">Todas</option></Select>
            <Select name="cliente" defaultValue={sp(q.cliente) ?? ""} className="max-w-52"><option value="">Todos los clientes</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select>
            <Select name="moneda" defaultValue={sp(q.moneda) ?? ""} className="w-28"><option value="">Moneda</option><option value="NIO">NIO</option><option value="USD">USD</option></Select>
            <button className="h-9 rounded-md border px-3 text-sm">Filtrar</button>
          </form>
          {d.rows.length ? (
            <Table><thead><tr><Th>Número</Th><Th>Cliente</Th><Th>Concepto</Th><Th>Emisión</Th><Th>Vence</Th><Th>Importe</Th><Th>Saldo</Th><Th>Estado</Th></tr></thead>
              <tbody>{d.rows.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50"><Td><Link className="font-medium hover:underline" href={`/finanzas/facturas/${i.id}`}>{i.number}</Link></Td><Td>{i.clientName}</Td><Td className="max-w-64 truncate">{i.concept}</Td><Td>{formatDate(i.issueDate)}</Td><Td>{formatDate(i.dueDate)}</Td><Td className="tabular">{formatMoney(i.amount, i.currency)}</Td><Td className="tabular">{formatMoney(i.balance, i.currency)}</Td><Td><StatusBadge list={INVOICE_STATUSES} value={i.status} />{i.partial && i.status === "vencida" && <div className="text-xs text-amber-700">con pago parcial</div>}</Td></tr>
              ))}</tbody>
            </Table>
          ) : <div className="p-4"><Empty>No hay facturas con estos filtros.</Empty></div>}
        </Card>
        {d.write && (
          <Card title="Nueva cuenta por cobrar">
            <ActionForm action={createInvoiceAction}>
              <Field label="Cliente"><Select name="clientId" required>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select></Field>
              <Field label="Concepto"><Input name="concept" required /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Importe"><Input name="amount" required inputMode="decimal" /></Field>
                <Field label="Moneda"><Select name="currency"><option value="NIO">C$</option><option value="USD">US$</option></Select></Field>
                <Field label="Emisión"><Input type="date" name="issueDate" required defaultValue={d.today} /></Field>
                <Field label="Vencimiento"><Input type="date" name="dueDate" required /></Field>
              </div>
              <SubmitButton className="w-full">Crear</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

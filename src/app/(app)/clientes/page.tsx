import Link from "next/link";
import { Plus } from "lucide-react";
import { load, sp, type SP } from "../_lib/page";
import { listClients } from "@/server/services/clients";
import { can } from "@/server/ctx";
import { Card, Empty, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th, Tabs } from "@/components/ui";
import { CLIENT_STATUSES } from "@/lib/domain";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Clientes" };

export default async function ClientsPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const scope = (sp(q.scope) ?? "operativos") as "operativos" | "inactivos" | "todos";
  const d = await load(["clients.read"], async (ctx) => ({
    rows: await listClients(ctx, { q: sp(q.q), status: sp(q.status), scope }),
    canWrite: can(ctx, "clients.write"),
    canFinance: can(ctx, "finance.read"),
  }));
  return (
    <>
      <PageHeader title="Clientes" subtitle="Registro central compartido por todos los departamentos" actions={d.canWrite && <LinkButton variant="primary" href="/clientes/nuevo"><Plus className="size-4" />Nuevo cliente</LinkButton>} />
      <Tabs active={scope} tabs={[{ key: "operativos", label: "Activos y en pausa", href: "/clientes" }, { key: "inactivos", label: "Archivados y dados de baja", href: "/clientes?scope=inactivos" }, { key: "todos", label: "Todos", href: "/clientes?scope=todos" }]} />
      <Card padded={false}>
        <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <input type="hidden" name="scope" value={scope} />
          <Input name="q" placeholder="Buscar por nombre, contacto o ciudad" defaultValue={sp(q.q)} className="max-w-xs" />
          <Select name="status" defaultValue={sp(q.status) ?? ""} className="max-w-48">
            <option value="">Todos los estados</option>
            {CLIENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <button className="h-9 rounded-md border border-slate-300 px-3 text-sm">Filtrar</button>
        </form>
        {d.rows.length ? (
          <Table>
            <thead><tr><Th>Cliente</Th><Th>Contacto</Th><Th>Ciudad</Th><Th>Responsable</Th><Th>Paquete</Th>{d.canFinance && <Th>Precio</Th>}<Th>Inicio</Th><Th>Estado</Th></tr></thead>
            <tbody>
              {d.rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td><Link href={`/clientes/${c.id}`} className="font-medium text-slate-900 hover:underline">{c.tradeName}</Link></Td>
                  <Td>{c.contactName ?? "—"}<div className="text-xs text-slate-500">{c.phone}</div></Td>
                  <Td>{c.city ?? "—"}</Td>
                  <Td>{c.accountManager ?? "—"}</Td>
                  <Td>{c.packageName ?? "—"}</Td>
                  {d.canFinance && <Td className="tabular">{c.monthlyPrice != null ? formatMoney(c.monthlyPrice, c.currency ?? "NIO") : "—"}</Td>}
                  <Td>{formatDate(c.serviceStartDate)}</Td>
                  <Td><StatusBadge list={CLIENT_STATUSES} value={c.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <div className="p-4"><Empty>No hay clientes con estos filtros.</Empty></div>}
      </Card>
    </>
  );
}

import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { listPlans } from "@/server/services/strategy";
import { listClients } from "@/server/services/clients";
import { Badge, Card, Empty, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PLAN_STATUSES } from "@/lib/domain";
import { addMonths, firstOfMonth, formatDate, formatPeriod } from "@/lib/dates";
import { createPlanAction } from "./actions";

export const metadata = { title: "Estrategia y campañas" };

export default async function StrategyPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["strategy.read"], async (ctx) => {
    const month = sp(q.mes) ?? addMonths(firstOfMonth(ctx.today), 1).slice(0, 7);
    return {
      month,
      rows: await listPlans(ctx, { period: `${month}-01`, status: sp(q.estado), clientId: sp(q.cliente) }),
      clients: await listClients(ctx, { scope: "operativos" }),
      canWrite: can(ctx, "strategy.write"),
      today: ctx.today,
    };
  });
  return (
    <>
      <PageHeader title="Estrategia y campañas" subtitle={`Planificación de ${formatPeriod(d.month + "-01")}`} />
      <Card padded={false}>
        <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input type="month" name="mes" defaultValue={d.month} className="w-44" />
          <Select name="cliente" defaultValue={sp(q.cliente) ?? ""} className="max-w-52"><option value="">Todos los clientes</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select>
          <Select name="estado" defaultValue={sp(q.estado) ?? ""} className="max-w-56"><option value="">Todos los estados</option>{PLAN_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
          <button className="h-9 rounded-md border px-3 text-sm">Filtrar</button>
        </form>
        {d.rows.length ? (
          <Table>
            <thead><tr><Th>Cliente</Th><Th>Estratega</Th><Th>Fecha límite</Th><Th>Reels y diseños definidos</Th><Th>Estado</Th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.plan.id} className="hover:bg-slate-50">
                <Td><Link href={`/estrategia/${r.plan.id}`} className="font-medium hover:underline">{r.clientName}</Link></Td>
                <Td>{r.strategist ?? <Badge tone="yellow">Sin asignar</Badge>}</Td>
                <Td>{r.plan.dueDate ? <Badge tone={r.plan.dueDate < d.today && !["aprobada", "en_produccion", "completada"].includes(r.plan.status) ? "red" : "gray"}>{formatDate(r.plan.dueDate)}</Badge> : "—"}</Td>
                <Td className="tabular">{r.filled}/{r.total}</Td>
                <Td><StatusBadge list={PLAN_STATUSES} value={r.plan.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <div className="p-4"><Empty>No hay planificaciones para este mes. Se generan automáticamente para los clientes con estrategia en su contrato.</Empty></div>}
      </Card>
      {d.canWrite && (
        <Card title="Crear planificación manualmente" className="mt-4">
          <ActionForm action={createPlanAction} inline>
            <Select name="clientId" required className="w-56">{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select>
            <Input type="month" name="month" required defaultValue={d.month} className="w-44" />
            <SubmitButton size="sm">Crear (sin duplicar)</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}

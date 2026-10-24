import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { productionOverview } from "@/server/services/production";
import { listClients } from "@/server/services/clients";
import { listAssignableEmployees } from "@/server/services/employees";
import { Badge, Card, Empty, Input, PageHeader, Progress, Select, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { BOARD_STATUSES } from "@/lib/domain";
import { formatDate, formatPeriod } from "@/lib/dates";
import { formatPercent } from "@/lib/money";

export const metadata = { title: "Producción mensual" };

export default async function ProductionPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["production.read"], async (ctx) => {
    const month = sp(q.mes) ?? ctx.today.slice(0, 7);
    return {
      month,
      rows: await productionOverview(ctx, { period: `${month}-01`, clientId: sp(q.cliente), designerId: sp(q.disenador), editorId: sp(q.editor), status: sp(q.estado), delayedOnly: sp(q.retraso) === "1" }),
      clients: await listClients(ctx, { scope: "todos" }),
      employees: await listAssignableEmployees(ctx),
    };
  });
  const ready = d.rows.filter((r) => r.status === "listo_para_publicar").length;
  const emp = (name: string, label: string) => <Select name={name} defaultValue={sp(q[name]) ?? ""} className="max-w-44"><option value="">{label}</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select>;
  return (
    <>
      <PageHeader title="Producción mensual" subtitle={`¿Quién tiene listos sus diseños, perfil y portada, y reels en ${formatPeriod(d.month + "-01")}?`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Clientes" value={d.rows.length} />
        <Stat label="Al 100 % (listos para publicar)" value={ready} tone={ready ? "green" : undefined} />
        <Stat label="Con retraso" value={d.rows.filter((r) => r.delayed).length} tone={d.rows.some((r) => r.delayed) ? "red" : undefined} />
        <Stat label="Avance promedio" value={d.rows.length ? formatPercent(d.rows.reduce((a, r) => a + r.progress, 0) / d.rows.length) : "—"} />
      </div>
      <Card padded={false}>
        <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <Input type="month" name="mes" defaultValue={d.month} className="w-44" />
          <Select name="cliente" defaultValue={sp(q.cliente) ?? ""} className="max-w-44"><option value="">Todos los clientes</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select>
          {emp("disenador", "Todo diseñador")}
          {emp("editor", "Todo editor")}
          <Select name="estado" defaultValue={sp(q.estado) ?? ""} className="max-w-44"><option value="">Todos los estados</option>{BOARD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="retraso" value="1" defaultChecked={sp(q.retraso) === "1"} className="size-4" />Solo con retraso</label>
          <button className="h-9 rounded-md border px-3 text-sm">Filtrar</button>
        </form>
        {d.rows.length ? (
          <Table>
            <thead><tr><Th>Cliente</Th><Th>Diseños</Th><Th>Perfil y portada</Th><Th>Reels</Th><Th>Stories</Th><Th className="w-44">Avance</Th><Th>Estado</Th><Th>Responsables</Th><Th>Fecha límite</Th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link href={`/produccion/${r.id}`} className="font-medium hover:underline">{r.clientName}</Link></Td>
                <Td className="tabular"><Badge tone={r.designs.done === r.designs.total ? "green" : "gray"} icon={false}>{r.designs.done}/{r.designs.total}</Badge></Td>
                <Td className="tabular"><Badge tone={r.profileCover.done === r.profileCover.total ? "green" : "gray"} icon={false}>{r.profileCover.done}/{r.profileCover.total}</Badge></Td>
                <Td className="tabular"><Badge tone={r.reels.done === r.reels.total ? "green" : "gray"} icon={false}>{r.reels.done}/{r.reels.total}</Badge></Td>
                <Td className="tabular">{r.stories.total ? <Badge tone={r.stories.done === r.stories.total ? "green" : "gray"} icon={false}>{r.stories.done}/{r.stories.total}</Badge> : "—"}</Td>
                <Td><div className="flex items-center gap-2"><Progress value={r.progress} tone={r.delayed ? "red" : undefined} /><span className="w-12 text-xs tabular">{formatPercent(r.progress)}</span></div></Td>
                <Td className="space-x-1"><StatusBadge list={BOARD_STATUSES} value={r.status} />{r.delayed && r.status !== "con_retraso" && r.status !== "produccion_incompleta" && <Badge tone="red">{r.overdueCount} atrasado(s)</Badge>}</Td>
                <Td className="text-xs">🎨 {r.designer ?? "—"}<br />🎬 {r.editor ?? "—"}</Td>
                <Td>{formatDate(r.dueDate)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <div className="p-4"><Empty>No hay tableros para este mes con esos filtros.</Empty></div>}
      </Card>
    </>
  );
}

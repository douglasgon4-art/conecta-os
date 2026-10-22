import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { availableDatasets, DATASETS, reportRows, type Dataset } from "@/server/services/reports";
import { listClients } from "@/server/services/clients";
import { listAssignableEmployees } from "@/server/services/employees";
import { Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { DEPARTMENTS } from "@/lib/domain";
import { addDays, firstOfMonth, startOfWeek } from "@/lib/dates";

export const metadata = { title: "Informes" };

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["reports.read"], async (ctx) => {
    const sets = availableDatasets(ctx);
    const dataset = (sp(q.informe) as Dataset) ?? sets[0];
    const range = sp(q.rango) ?? "mes";
    const from = sp(q.desde) ?? (range === "dia" ? ctx.today : range === "semana" ? startOfWeek(ctx.today) : firstOfMonth(ctx.today));
    const to = sp(q.hasta) ?? (range === "semana" ? addDays(startOfWeek(ctx.today), 6) : ctx.today);
    const filters = { from, to, clientId: sp(q.cliente), department: sp(q.departamento), responsibleId: sp(q.responsable), status: sp(q.estado) };
    return {
      sets,
      dataset,
      filters,
      rows: dataset ? await reportRows(ctx, dataset, filters) : [],
      clients: can(ctx, "clients.read") ? await listClients(ctx, { scope: "todos" }) : [],
      employees: await listAssignableEmployees(ctx),
      canExport: can(ctx, "reports.export"),
    };
  });
  const f = d.filters;
  const exportUrl = `/api/export?${new URLSearchParams(Object.entries({ informe: d.dataset, desde: f.from, hasta: f.to, cliente: f.clientId, departamento: f.department, responsable: f.responsibleId, estado: f.status }).filter(([, v]) => v) as [string, string][])}`;
  const headers = d.rows[0] ? Object.keys(d.rows[0]) : [];
  return (
    <>
      <PageHeader title="Informes" subtitle="Diarios, semanales, mensuales o por rango de fechas; calculados desde los datos reales" actions={d.canExport && d.rows.length > 0 && <a href={exportUrl} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium">Exportar CSV</a>} />
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Field label="Informe" className="sm:col-span-2"><Select name="informe" defaultValue={d.dataset}>{d.sets.map((k) => <option key={k} value={k}>{DATASETS[k]}</option>)}</Select></Field>
          <Field label="Rango rápido"><Select name="rango" defaultValue={sp(q.rango) ?? "mes"}><option value="dia">Hoy</option><option value="semana">Esta semana</option><option value="mes">Este mes</option></Select></Field>
          <Field label="Desde"><Input type="date" name="desde" defaultValue={sp(q.desde) ?? ""} /></Field>
          <Field label="Hasta"><Input type="date" name="hasta" defaultValue={sp(q.hasta) ?? ""} /></Field>
          <Field label="Cliente"><Select name="cliente" defaultValue={f.clientId ?? ""}><option value="">Todos</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select></Field>
          <Field label="Departamento"><Select name="departamento" defaultValue={f.department ?? ""}><option value="">Todos</option>{DEPARTMENTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
          <Field label="Responsable"><Select name="responsable" defaultValue={f.responsibleId ?? ""}><option value="">Todos</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
          <Field label="Estado (código)"><Input name="estado" defaultValue={f.status ?? ""} placeholder="p. ej. pendiente" /></Field>
          <div className="flex items-end"><button className="h-9 w-full rounded-md bg-brand-600 px-3 text-sm font-medium text-white">Generar</button></div>
        </form>
        <p className="mt-2 text-xs text-slate-500">Período: {f.from} a {f.to} · {d.rows.length} fila(s)</p>
      </Card>
      <Card padded={false}>
        {d.rows.length ? (
          <Table>
            <thead><tr>{headers.map((h) => <Th key={h}>{h.replace(/_/g, " ")}</Th>)}</tr></thead>
            <tbody>{d.rows.slice(0, 500).map((r, i) => <tr key={i}>{headers.map((h) => <Td key={h} className="text-xs">{r[h] ?? "—"}</Td>)}</tr>)}</tbody>
          </Table>
        ) : <div className="p-4"><Empty>Sin datos para estos filtros.</Empty></div>}
      </Card>
    </>
  );
}

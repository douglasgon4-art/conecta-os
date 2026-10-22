import Link from "next/link";
import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { listTasks } from "@/server/services/tasks";
import { listClients } from "@/server/services/clients";
import { listAssignableEmployees } from "@/server/services/employees";
import { Badge, Card, Empty, Field, Input, PageHeader, Select, StatusBadge, Table, Tabs, Td, Textarea, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DEPARTMENTS, TASK_STATUSES, labelOf } from "@/lib/domain";
import { formatDate } from "@/lib/dates";
import { assignTaskAction, createTaskAction, taskStatusAction } from "./actions";

export const metadata = { title: "Tareas" };

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["tasks.read", "tasks.update_own"], async (ctx) => {
    const all = can(ctx, "tasks.read");
    const scope = (sp(q.scope) ?? (all ? "todas" : "mias")) as "mias" | "todas";
    return {
      scope,
      all,
      write: can(ctx, "tasks.write"),
      rows: await listTasks(ctx, { scope, status: sp(q.estado) ?? "abiertas", overdue: sp(q.overdue) === "1", assigneeId: sp(q.responsable) }),
      employees: await listAssignableEmployees(ctx),
      clients: can(ctx, "clients.read") ? await listClients(ctx, { scope: "operativos" }) : [],
      today: ctx.today,
    };
  });
  return (
    <>
      <PageHeader title="Tareas" subtitle="Cada tarea tiene un responsable y una fecha" />
      <Tabs active={d.scope} tabs={[{ key: "mias", label: "Mis tareas", href: "/tareas?scope=mias" }, ...(d.all ? [{ key: "todas", label: "Todo el equipo", href: "/tareas?scope=todas" }] : [])]} />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card padded={false}>
          <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <input type="hidden" name="scope" value={d.scope} />
            <Select name="estado" defaultValue={sp(q.estado) ?? "abiertas"} className="max-w-40"><option value="abiertas">Abiertas</option><option value="completada">Completadas</option><option value="cancelada">Canceladas</option><option value="todas">Todas</option></Select>
            {d.all && <Select name="responsable" defaultValue={sp(q.responsable) ?? ""} className="max-w-44"><option value="">Todos</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select>}
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={sp(q.overdue) === "1"} className="size-4" />Solo atrasadas</label>
            <button className="h-9 rounded-md border px-3 text-sm">Filtrar</button>
          </form>
          {d.rows.length ? (
            <Table>
              <thead><tr><Th>Tarea</Th><Th>Cliente</Th><Th>Responsable</Th><Th>Vence</Th><Th>Estado</Th><Th>Acciones</Th></tr></thead>
              <tbody>{d.rows.map(({ task: t, clientName, assignee }) => (
                <tr key={t.id}>
                  <Td><div className="font-medium">{t.title}</div><div className="text-xs text-slate-500">{labelOf(DEPARTMENTS, t.department)}{t.priority === "alta" && " · prioridad alta"}{t.description && ` · ${t.description}`}</div></Td>
                  <Td>{t.clientId ? <Link className="hover:underline" href={`/clientes/${t.clientId}`}>{clientName}</Link> : "—"}</Td>
                  <Td>{d.write ? (
                    <ActionForm action={assignTaskAction} inline><input type="hidden" name="id" value={t.id} /><Select name="assigneeId" defaultValue={t.assigneeId ?? ""} className="h-8 w-40 text-xs"><option value="">Sin asignar</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select><SubmitButton size="sm" variant="ghost">Asignar</SubmitButton></ActionForm>
                  ) : assignee ?? "—"}</Td>
                  <Td>{t.dueDate ? <Badge tone={t.dueDate < d.today && ["pendiente", "en_progreso"].includes(t.status) ? "red" : "gray"}>{formatDate(t.dueDate)}</Badge> : "—"}</Td>
                  <Td><StatusBadge list={TASK_STATUSES} value={t.status} /></Td>
                  <Td>{["pendiente", "en_progreso"].includes(t.status) && (
                    <div className="flex gap-1">
                      {t.status === "pendiente" && <ActionForm action={taskStatusAction} inline><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="en_progreso" /><SubmitButton size="sm" variant="secondary">Iniciar</SubmitButton></ActionForm>}
                      <ActionForm action={taskStatusAction} inline><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="completada" /><SubmitButton size="sm">Completar</SubmitButton></ActionForm>
                      {d.write && <ActionForm action={taskStatusAction} inline><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value="cancelada" /><SubmitButton size="sm" variant="ghost">Cancelar</SubmitButton></ActionForm>}
                    </div>
                  )}</Td>
                </tr>
              ))}</tbody>
            </Table>
          ) : <div className="p-4"><Empty>No hay tareas.</Empty></div>}
        </Card>
        {d.write && (
          <Card title="Nueva tarea">
            <ActionForm action={createTaskAction} resetOnSuccess>
              <Field label="Título *"><Input name="title" required /></Field>
              <Field label="Descripción"><Textarea name="description" rows={2} /></Field>
              <Field label="Cliente"><Select name="clientId" defaultValue=""><option value="">—</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}</Select></Field>
              <Field label="Departamento"><Select name="department" defaultValue=""><option value="">—</option>{DEPARTMENTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
              <Field label="Responsable"><Select name="assigneeId" defaultValue=""><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
              <Field label="Fecha límite"><Input type="date" name="dueDate" /></Field>
              <Field label="Prioridad"><Select name="priority" defaultValue="normal"><option value="baja">Baja</option><option value="normal">Normal</option><option value="alta">Alta</option></Select></Field>
              <SubmitButton className="w-full">Crear tarea</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

import Link from "next/link";
import { Plus } from "lucide-react";
import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { listEmployees } from "@/server/services/employees";
import { Card, Empty, Input, LinkButton, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { DEPARTMENTS, EMPLOYEE_STATUSES, labelOf } from "@/lib/domain";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Colaboradores" };

export default async function EmployeesPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const d = await load(["employees.read"], async (ctx) => ({ rows: await listEmployees(ctx, { q: sp(q.q), includeSalary: true }), write: can(ctx, "employees.write"), salary: can(ctx, "employees.salary") }));
  return (
    <>
      <PageHeader title="Colaboradores" subtitle={`${d.rows.filter((r) => r.status === "activo").length} activos`} actions={d.write && <LinkButton variant="primary" href="/colaboradores/nuevo"><Plus className="size-4" />Nuevo colaborador</LinkButton>} />
      <Card padded={false}>
        <form className="border-b border-slate-100 p-3"><Input name="q" placeholder="Buscar por nombre, correo o cargo" defaultValue={sp(q.q)} className="max-w-sm" /></form>
        {d.rows.length ? (
          <Table>
            <thead><tr><Th>Nombre</Th><Th>Cargo</Th><Th>Departamento</Th><Th>Inicio</Th>{d.salary && <Th>Salario mensual</Th>}<Th>Pago</Th><Th>Estado</Th></tr></thead>
            <tbody>{d.rows.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <Td><Link className="font-medium hover:underline" href={`/colaboradores/${e.id}`}>{e.fullName}</Link><div className="text-xs text-slate-500">{e.email ?? e.phone}</div></Td>
                <Td>{e.position ?? "—"}</Td><Td>{labelOf(DEPARTMENTS, e.departmentKey)}</Td><Td>{formatDate(e.startDate)}</Td>
                {d.salary && <Td className="tabular">{e.salary != null ? formatMoney(e.salary, e.currency ?? "NIO") : "—"}</Td>}
                <Td>{e.payFrequency}</Td><Td><StatusBadge list={EMPLOYEE_STATUSES} value={e.status} /></Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <div className="p-4"><Empty>No hay colaboradores.</Empty></div>}
      </Card>
    </>
  );
}

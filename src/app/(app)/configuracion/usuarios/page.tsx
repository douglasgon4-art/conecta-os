import { load } from "../../_lib/page";
import { listRolesWithPermissions, listUsers } from "@/server/services/users";
import { listAssignableEmployees } from "@/server/services/employees";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { formatDateTime } from "@/lib/dates";
import { ConfigTabs } from "../nav";
import { createUserAction, userActiveAction, userRolesAction } from "../actions";

export const metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const d = await load(["settings.manage"], async (ctx) => ({ users: await listUsers(ctx), roles: (await listRolesWithPermissions(ctx)).roles, employees: await listAssignableEmployees(ctx) }));
  return (
    <>
      <PageHeader title="Usuarios" />
      <ConfigTabs active="usuarios" />
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Usuario</Th><Th>Colaborador</Th><Th>Roles</Th><Th>Último acceso</Th><Th>Estado</Th></tr></thead>
            <tbody>{d.users.map((u) => (
              <tr key={u.id}>
                <Td><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.email}</div></Td>
                <Td>{u.employee ?? "—"}</Td>
                <Td>
                  <ActionForm action={userRolesAction} className="space-y-1">
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="flex flex-wrap gap-x-2">{d.roles.map((r) => <label key={r.id} className="flex items-center gap-1 text-xs"><input type="checkbox" name="roleKeys[]" value={r.key} defaultChecked={u.roles.some((x) => x.key === r.key)} className="size-3.5" />{r.name}</label>)}</div>
                    <SubmitButton size="sm" variant="ghost">Guardar roles</SubmitButton>
                  </ActionForm>
                </Td>
                <Td className="text-xs">{formatDateTime(u.lastLoginAt)}</Td>
                <Td><ActionForm action={userActiveAction} inline><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="active" value={u.isActive ? "0" : "1"} /><Badge tone={u.isActive ? "green" : "gray"}>{u.isActive ? "Activo" : "Inactivo"}</Badge><SubmitButton size="sm" variant="ghost">{u.isActive ? "Desactivar" : "Activar"}</SubmitButton></ActionForm></Td>
              </tr>
            ))}</tbody>
          </Table>
        </Card>
        <Card title="Nuevo usuario">
          <ActionForm action={createUserAction} resetOnSuccess>
            <Field label="Nombre"><Input name="name" required /></Field>
            <Field label="Correo"><Input type="email" name="email" required /></Field>
            <Field label="Contraseña inicial"><Input type="password" name="password" required minLength={8} /></Field>
            <Field label="Colaborador vinculado"><Select name="employeeId" defaultValue=""><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
            <fieldset className="grid grid-cols-2 gap-1 text-sm">{d.roles.map((r) => <label key={r.id} className="flex items-center gap-1.5"><input type="checkbox" name="roleKeys[]" value={r.key} className="size-4" />{r.name}</label>)}</fieldset>
            <SubmitButton className="w-full">Crear usuario</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

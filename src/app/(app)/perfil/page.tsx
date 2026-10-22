import { load } from "../_lib/page";
import { Card, DL, Field, Input, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PERMISSIONS } from "@/server/auth/permissions";
import { passwordAction } from "./actions";

export const metadata = { title: "Mi perfil" };

export default async function ProfilePage() {
  const d = await load([], async () => ({}));
  const a = d.actor;
  return (
    <>
      <PageHeader title="Mi perfil" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Cuenta">
          <DL items={[["Nombre", a.name], ["Roles", a.roles.join(", ")], ["Colaborador vinculado", a.employeeId ? "Sí" : "No"]]} />
          <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">Permisos efectivos</h3>
          <ul className="mt-1 grid grid-cols-1 gap-0.5 text-xs text-slate-600 sm:grid-cols-2">{[...a.permissions].sort().map((p) => <li key={p}>• {PERMISSIONS[p as keyof typeof PERMISSIONS]?.[1] ?? p}</li>)}</ul>
        </Card>
        <Card title="Cambiar contraseña">
          <ActionForm action={passwordAction} resetOnSuccess>
            <Field label="Contraseña actual"><Input type="password" name="current" required /></Field>
            <Field label="Nueva contraseña"><Input type="password" name="next" required minLength={8} /></Field>
            <Field label="Repetir nueva contraseña"><Input type="password" name="confirm" required minLength={8} /></Field>
            <SubmitButton>Actualizar</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

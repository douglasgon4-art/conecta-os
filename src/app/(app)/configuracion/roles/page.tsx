import { load } from "../../_lib/page";
import { listRolesWithPermissions } from "@/server/services/users";
import { NOTIFICATION_TYPES } from "@/server/services/notification-types";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ConfigTabs } from "../nav";
import { roleNotifAction, rolePermsAction } from "../actions";

export const metadata = { title: "Roles y permisos" };

export default async function RolesPage() {
  const d = await load(["settings.manage"], async (ctx) => listRolesWithPermissions(ctx));
  const modules = [...new Set(d.permissions.map((p) => p.module))];
  return (
    <>
      <PageHeader title="Roles y permisos" subtitle="La autorización se aplica en el servidor y en la base de datos, no solo ocultando botones" />
      <ConfigTabs active="roles" />
      <div className="space-y-4">
        {d.roles.map((r) => (
          <Card key={r.id} title={`${r.name} — ${r.description ?? ""}`}>
            <ActionForm action={rolePermsAction}>
              <input type="hidden" name="roleId" value={r.id} />
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                {modules.map((m) => (
                  <fieldset key={m} className="rounded-md border border-slate-100 p-2">
                    <legend className="px-1 text-xs font-semibold uppercase text-slate-500">{m}</legend>
                    {d.permissions.filter((p) => p.module === m).map((p) => (
                      <label key={p.key} className="flex items-start gap-1.5 text-xs" title={p.key}><input type="checkbox" name="perms[]" value={p.key} defaultChecked={r.permissions.includes(p.key)} className="mt-0.5 size-3.5" />{p.description}</label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <SubmitButton size="sm">Guardar permisos de {r.name}</SubmitButton>
            </ActionForm>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">Notificaciones que recibe este rol</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(NOTIFICATION_TYPES).map(([type, label]) => {
                  const on = r.notifications.includes(type);
                  return (
                    <ActionForm key={type} action={roleNotifAction} inline>
                      <input type="hidden" name="roleId" value={r.id} /><input type="hidden" name="type" value={type} /><input type="hidden" name="enabled" value={on ? "0" : "1"} />
                      <SubmitButton size="sm" variant={on ? "primary" : "secondary"}>{on ? "✓ " : ""}{label}</SubmitButton>
                    </ActionForm>
                  );
                })}
              </div>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}

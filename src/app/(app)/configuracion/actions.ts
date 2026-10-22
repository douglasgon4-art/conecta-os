"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import { updateSetting, SETTINGS_SCHEMA, type Settings } from "@/server/services/settings";
import { createUser, setRoleNotification, setRolePermissions, setUserActive, setUserRoles } from "@/server/services/users";
import { createRuleSetVersion, validateRuleSet } from "@/server/services/payroll";
import { runAutomations } from "@/server/automations";
import { getActor } from "@/server/auth/session";
import { revalidatePath } from "next/cache";

export async function settingsAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run(
    async (ctx) => {
      for (const key of Object.keys(SETTINGS_SCHEMA) as (keyof Settings)[]) {
        if (!(key in o) || key === "onboarding_tasks") continue;
        const raw = o[key] as string;
        const value = ["agency_name", "base_currency", "overhead_allocation"].includes(key) ? raw : Number(raw);
        await updateSetting(ctx, key, value);
      }
      if (o.onboarding_tasks) await updateSetting(ctx, "onboarding_tasks", JSON.parse(String(o.onboarding_tasks)));
    },
    { revalidate: ["/configuracion"], success: "Ajustes guardados" },
  );
}
export async function rolePermsAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Cambiar permisos afecta lo que pueden ver y hacer todos los usuarios con este rol. ¿Confirmas?", at: Date.now() };
  return run((ctx) => setRolePermissions(ctx, String(o.roleId), ([] as string[]).concat((o.perms as string[]) ?? [])), { revalidate: ["/configuracion/roles"], success: "Permisos actualizados" });
}
export async function roleNotifAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => setRoleNotification(ctx, String(o.roleId), String(o.type), o.enabled === "1"), { revalidate: ["/configuracion/roles"], success: "Actualizado" });
}
export async function createUserAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Se creará un usuario con acceso al sistema según los roles elegidos. ¿Confirmas?", at: Date.now() };
  return run((ctx) => createUser(ctx, { ...o, roleKeys: ([] as unknown[]).concat(o.roleKeys ?? []) as string[] }), { revalidate: ["/configuracion/usuarios"], success: "Usuario creado" });
}
export async function userRolesAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "¿Cambiar los roles (y por tanto los permisos) de este usuario?", at: Date.now() };
  return run((ctx) => setUserRoles(ctx, String(o.userId), ([] as string[]).concat((o.roleKeys as string[]) ?? [])), { revalidate: ["/configuracion/usuarios"], success: "Roles actualizados" });
}
export async function userActiveAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => setUserActive(ctx, String(o.userId), o.active === "1"), { revalidate: ["/configuracion/usuarios"], success: "Usuario actualizado" });
}
export async function ruleVersionAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => createRuleSetVersion(ctx, { version: String(o.version), effectiveFrom: String(o.effectiveFrom), params: JSON.parse(String(o.params)), sources: String(o.sources), notes: o.notes as string }), { revalidate: ["/configuracion/reglas-laborales"], success: "Nueva versión creada (pendiente de validación)" });
}
export async function validateRulesAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => validateRuleSet(ctx, String(o.id), { confirm: isConfirmed(o), note: o.note as string }), { revalidate: ["/configuracion/reglas-laborales", "/nomina"], success: "Reglas marcadas como validadas" });
}
export async function runAutomationsAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const actor = await getActor();
  if (!actor || !actor.permissions.has("automations.run")) return { ok: false, error: "No tienes permiso para ejecutar automatizaciones", at: Date.now() };
  const res = await runAutomations({ triggeredBy: `usuario:${actor.name}`, force: true, jobs: o.job ? [String(o.job)] : undefined });
  revalidatePath("/", "layout");
  const failed = res.filter((r) => r.status === "failed");
  return failed.length
    ? { ok: false, error: `Fallaron: ${failed.map((f) => `${f.job} (${f.error})`).join("; ")}`, at: Date.now() }
    : { ok: true, message: `Ejecutadas: ${res.map((r) => r.job).join(", ")}`, at: Date.now() };
}

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE } from "./core";
import type { Actor } from "../ctx";
import type { Permission } from "./permissions";

export const getActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

/** Para páginas: exige al menos uno de los permisos; si no, muestra la página de acceso denegado. */
export async function requirePagePerm(...perms: Permission[]): Promise<Actor> {
  const actor = await requireActor();
  if (!perms.some((p) => actor.permissions.has(p))) redirect("/sin-acceso");
  return actor;
}

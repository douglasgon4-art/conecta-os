import "server-only";
import { notFound } from "next/navigation";
import { requireActor, requirePagePerm } from "@/server/auth/session";
import { withCtx, type Actor, type Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import type { Permission } from "@/server/auth/permissions";

/** Carga datos de una página dentro del contexto de seguridad del usuario. */
export async function load<T>(perms: Permission[], fn: (ctx: Ctx, actor: Actor) => Promise<T>): Promise<T & { actor: Actor }> {
  const actor = perms.length ? await requirePagePerm(...perms) : await requireActor();
  try {
    const data = await withCtx(actor, (ctx) => fn(ctx, actor));
    return Object.assign(data as object, { actor }) as T & { actor: Actor };
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const sp = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;

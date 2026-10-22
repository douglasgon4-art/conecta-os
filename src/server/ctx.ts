import { sql } from "drizzle-orm";
import { db, type Tx } from "./db";
import { auditLogs } from "./db/schema";
import { AppError, forbidden, translateDbError } from "./errors";
import { todayISO } from "@/lib/dates";
import type { Permission } from "./auth/permissions";

export type ActorSource = "ui" | "agent" | "automation" | "system";

export type Actor = {
  userId: string | null;
  employeeId: string | null;
  name: string;
  roles: string[];
  permissions: Set<string>;
  source: ActorSource;
};

export type Ctx = {
  tx: Tx;
  actor: Actor;
  now: Date;
  today: string;
  /**
   * Ejecuta una parte de la operación con privilegios de sistema (p. ej. crear la factura al convertir una venta).
   * Solo debe usarse DESPUÉS de verificar el permiso de la acción principal.
   */
  elevate<T>(fn: () => Promise<T>): Promise<T>;
  readonly elevated: boolean;
};

export function systemActor(name = "Sistema", source: ActorSource = "automation"): Actor {
  return { userId: null, employeeId: null, name, roles: [], permissions: new Set(), source };
}

async function applyDbContext(tx: Tx, actor: Actor, system: boolean) {
  await tx.execute(sql`select
    set_config('app.user_id', ${actor.userId ?? ""}, true),
    set_config('app.perms', ${[...actor.permissions].join(",")}, true),
    set_config('app.system', ${system ? "on" : ""}, true)`);
}

/** Abre una transacción con el contexto de seguridad (RLS) del actor. Toda operación de datos pasa por aquí. */
export async function withCtx<T>(actor: Actor, fn: (ctx: Ctx) => Promise<T>, opts: { now?: Date } = {}): Promise<T> {
  const now = opts.now ?? new Date();
  const isSystem = actor.source === "automation" || actor.source === "system";
  try {
    return await db.transaction(async (tx) => {
      await applyDbContext(tx, actor, isSystem);
      let depth = 0;
      const ctx: Ctx = {
        tx,
        actor,
        now,
        today: todayISO(now),
        get elevated() {
          return depth > 0;
        },
        async elevate(inner) {
          if (isSystem) return inner();
          depth++;
          if (depth === 1) await tx.execute(sql`select set_config('app.system', 'on', true)`);
          try {
            return await inner();
          } finally {
            depth--;
            if (depth === 0) await tx.execute(sql`select set_config('app.system', '', true)`);
          }
        },
      };
      return fn(ctx);
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    const translated = translateDbError(e);
    if (translated) throw translated;
    throw e;
  }
}

export function can(ctx: Ctx | Actor, perm: Permission): boolean {
  if ("actor" in ctx && ctx.elevated) return true;
  const actor = "actor" in ctx ? ctx.actor : ctx;
  if (actor.source === "automation" || actor.source === "system") return true;
  return actor.permissions.has(perm);
}

export function requirePerm(ctx: Ctx, ...perms: Permission[]): void {
  if (!perms.some((p) => can(ctx, p))) throw forbidden();
}

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  clientId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
};

export async function audit(ctx: Ctx, input: AuditInput) {
  await ctx.tx.insert(auditLogs).values({
    userId: ctx.actor.userId,
    source: ctx.actor.source,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    clientId: input.clientId ?? null,
    summary: input.summary,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}

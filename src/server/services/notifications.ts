import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { notificationRules, notifications, roles, userRoles, users } from "../db/schema";
import type { Ctx } from "../ctx";
import type { NotificationType } from "./notification-types";

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  severity?: "info" | "warning" | "critical" | "success";
  entityType?: string;
  entityId?: string;
  /** Clave de deduplicación: el mismo aviso no se repite para el mismo usuario. */
  dedupeKey: string;
  /** Colaboradores responsables: reciben el aviso siempre. */
  employeeIds?: (string | null | undefined)[];
  userIds?: (string | null | undefined)[];
  /** Difundir a los roles que tienen este tipo activado (por defecto true). */
  broadcast?: boolean;
};

export async function notify(ctx: Ctx, input: NotifyInput): Promise<number> {
  const recipients = new Set<string>(input.userIds?.filter(Boolean) as string[]);
  const empIds = (input.employeeIds?.filter(Boolean) as string[]) ?? [];
  if (empIds.length) {
    const rows = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.employeeId, empIds), eq(users.isActive, true)));
    rows.forEach((r) => recipients.add(r.id));
  }
  if (input.broadcast !== false) {
    const rows = await ctx.tx
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(notificationRules, and(eq(notificationRules.roleId, roles.id), eq(notificationRules.type, input.type)))
      .where(and(eq(notificationRules.enabled, true), eq(users.isActive, true)));
    rows.forEach((r) => recipients.add(r.id));
  }
  if (!recipients.size) return 0;
  const inserted = await ctx.elevate(() =>
    ctx.tx
      .insert(notifications)
      .values(
        [...recipients].map((userId) => ({
          userId,
          type: input.type,
          severity: input.severity ?? "info",
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          dedupeKey: input.dedupeKey,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id }),
  );
  return inserted.length;
}

export async function listNotifications(ctx: Ctx, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  if (!ctx.actor.userId) return [];
  const conds = [eq(notifications.userId, ctx.actor.userId)];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  return ctx.tx
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 50);
}

export async function unreadCount(ctx: Ctx): Promise<number> {
  if (!ctx.actor.userId) return 0;
  const [r] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.actor.userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function markRead(ctx: Ctx, id?: string) {
  if (!ctx.actor.userId) return;
  const conds = [eq(notifications.userId, ctx.actor.userId), isNull(notifications.readAt)];
  if (id) conds.push(eq(notifications.id, id));
  await ctx.tx.update(notifications).set({ readAt: new Date() }).where(and(...conds));
}

import { and, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { auditLogs, users } from "../db/schema";
import { requirePerm, type Ctx } from "../ctx";

export async function listAudit(ctx: Ctx, f: { q?: string; source?: string; from?: string; to?: string; limit?: number } = {}) {
  requirePerm(ctx, "audit.read");
  const conds = [];
  if (f.q) conds.push(ilike(auditLogs.summary, `%${f.q}%`));
  if (f.source) conds.push(eq(auditLogs.source, f.source));
  if (f.from) conds.push(gte(auditLogs.createdAt, new Date(`${f.from}T00:00:00-06:00`)));
  if (f.to) conds.push(lte(auditLogs.createdAt, new Date(`${f.to}T23:59:59-06:00`)));
  return ctx.tx
    .select({ a: auditLogs, user: users.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(f.limit ?? 300);
}

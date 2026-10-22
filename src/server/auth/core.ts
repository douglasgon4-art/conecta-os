import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { roles, rolePermissions, sessions, userRoles, users } from "../db/schema";
import { systemActor, withCtx, type Actor } from "../ctx";

export const SESSION_COOKIE = "conecta_session";
export const SESSION_DAYS = 30;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function loadActor(userId: string, source: Actor["source"] = "ui"): Promise<Actor | null> {
  return withCtx(systemActor("auth", "system"), async ({ tx }) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    if (!u || !u.isActive) return null;
    const roleRows = await tx
      .select({ key: roles.key, perm: rolePermissions.permissionKey })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    return {
      userId: u.id,
      employeeId: u.employeeId,
      name: u.name,
      roles: [...new Set(roleRows.map((r) => r.key))],
      permissions: new Set(roleRows.map((r) => r.perm).filter(Boolean) as string[]),
      source,
    };
  });
}

/** Verifica credenciales y crea una sesión. Devuelve el token en claro (solo para la cookie). */
export async function authenticate(email: string, password: string): Promise<{ token: string; expiresAt: Date } | null> {
  return withCtx(systemActor("auth", "system"), async ({ tx }) => {
    const [u] = await tx.select().from(users).where(sql`lower(${users.email}) = lower(${email.trim()})`);
    // Comparar siempre para no revelar por tiempo si el correo existe.
    const ok = await bcrypt.compare(password, u?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    if (!u || !u.isActive || !ok) return null;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await tx.insert(sessions).values({ userId: u.id, tokenHash: hashToken(token), expiresAt });
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    return { token, expiresAt };
  });
}

export async function resolveSession(token: string | undefined | null): Promise<Actor | null> {
  if (!token) return null;
  const userId = await withCtx(systemActor("auth", "system"), async ({ tx }) => {
    const [s] = await tx
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
    return s?.userId ?? null;
  });
  return userId ? loadActor(userId) : null;
}

export async function destroySession(token: string) {
  await withCtx(systemActor("auth", "system"), ({ tx }) => tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))));
}

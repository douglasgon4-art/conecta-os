import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { employees, notificationRules, permissions, rolePermissions, roles, sessions, userRoles, users } from "../db/schema";
import { audit, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, notFound } from "../errors";
import { parse, zRequiredText, zUuid } from "../validation";
import { hashPassword } from "../auth/core";

export const userInput = z.object({
  email: z.email("Correo inválido"),
  name: zRequiredText(150),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  roleKeys: z.array(z.string()).min(1, "Asigna al menos un rol"),
  employeeId: zUuid(),
});

export async function listUsers(ctx: Ctx) {
  requirePerm(ctx, "settings.manage");
  const rows = await ctx.tx
    .select({ user: users, employee: employees.fullName, role: roles.key, roleName: roles.name })
    .from(users)
    .leftJoin(employees, eq(employees.id, users.employeeId))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .orderBy(asc(users.name));
  const map = new Map<string, { id: string; email: string; name: string; isActive: boolean; employee: string | null; employeeId: string | null; lastLoginAt: Date | null; roles: { key: string; name: string }[] }>();
  for (const r of rows) {
    const u = map.get(r.user.id) ?? { id: r.user.id, email: r.user.email, name: r.user.name, isActive: r.user.isActive, employee: r.employee, employeeId: r.user.employeeId, lastLoginAt: r.user.lastLoginAt, roles: [] };
    if (r.role) u.roles.push({ key: r.role, name: r.roleName! });
    map.set(r.user.id, u);
  }
  return [...map.values()];
}

/** Crear usuarios y asignar roles cambia permisos: es una acción sensible. */
export async function createUser(ctx: Ctx, raw: z.input<typeof userInput>) {
  requirePerm(ctx, "settings.manage");
  const input = parse(userInput, raw);
  const roleRows = await ctx.tx.select().from(roles).where(inArray(roles.key, input.roleKeys));
  if (roleRows.length !== input.roleKeys.length) throw new AppError("VALIDATION", "Algún rol no existe");
  const [u] = await ctx.tx
    .insert(users)
    .values({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password), employeeId: input.employeeId ?? null })
    .returning({ id: users.id, email: users.email, name: users.name });
  await ctx.tx.insert(userRoles).values(roleRows.map((r) => ({ userId: u.id, roleId: r.id })));
  await audit(ctx, { action: "user.create", entityType: "user", entityId: u.id, summary: `Usuario creado: ${u.email} (${roleRows.map((r) => r.name).join(", ")})` });
  return u;
}

export async function setUserRoles(ctx: Ctx, userId: string, roleKeys: string[]) {
  requirePerm(ctx, "settings.manage");
  if (userId === ctx.actor.userId && !roleKeys.includes("gerencia") && ctx.actor.roles.includes("gerencia")) {
    throw conflict("No puedes quitarte a ti mismo el rol de Gerencia");
  }
  const roleRows = await ctx.tx.select().from(roles).where(inArray(roles.key, roleKeys));
  const before = await ctx.tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
  await ctx.tx.delete(userRoles).where(eq(userRoles.userId, userId));
  if (roleRows.length) await ctx.tx.insert(userRoles).values(roleRows.map((r) => ({ userId, roleId: r.id })));
  await audit(ctx, { action: "user.roles", entityType: "user", entityId: userId, summary: `Roles actualizados: ${before.map((b) => b.key).join(", ") || "—"} → ${roleKeys.join(", ") || "—"}`, before, after: roleKeys });
}

export async function setUserActive(ctx: Ctx, userId: string, isActive: boolean) {
  requirePerm(ctx, "settings.manage");
  if (userId === ctx.actor.userId && !isActive) throw conflict("No puedes desactivar tu propio usuario");
  await ctx.tx.update(users).set({ isActive }).where(eq(users.id, userId));
  if (!isActive) await ctx.tx.delete(sessions).where(eq(sessions.userId, userId));
  await audit(ctx, { action: "user.active", entityType: "user", entityId: userId, summary: isActive ? "Usuario activado" : "Usuario desactivado" });
}

export async function changeOwnPassword(ctx: Ctx, current: string, next: string) {
  if (!ctx.actor.userId) throw notFound("Usuario");
  if (next.length < 8) throw new AppError("VALIDATION", "La nueva contraseña debe tener al menos 8 caracteres");
  const [u] = await ctx.tx.select().from(users).where(eq(users.id, ctx.actor.userId));
  if (!(await bcrypt.compare(current, u.passwordHash))) throw new AppError("VALIDATION", "La contraseña actual no es correcta");
  await ctx.tx.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, u.id));
  await audit(ctx, { action: "user.password", entityType: "user", entityId: u.id, summary: "Contraseña cambiada" });
}

export async function listRolesWithPermissions(ctx: Ctx) {
  requirePerm(ctx, "settings.manage");
  const rs = await ctx.tx.select().from(roles).orderBy(asc(roles.name));
  const rp = await ctx.tx.select().from(rolePermissions);
  const perms = await ctx.tx.select().from(permissions).orderBy(asc(permissions.module), asc(permissions.key));
  const rules = await ctx.tx.select().from(notificationRules);
  return {
    roles: rs.map((r) => ({
      ...r,
      permissions: rp.filter((x) => x.roleId === r.id).map((x) => x.permissionKey),
      notifications: rules.filter((n) => n.roleId === r.id && n.enabled).map((n) => n.type),
    })),
    permissions: perms,
  };
}

export async function setRolePermissions(ctx: Ctx, roleId: string, permissionKeys: string[]) {
  requirePerm(ctx, "settings.manage");
  const [role] = await ctx.tx.select().from(roles).where(eq(roles.id, roleId));
  if (!role) throw notFound("Rol");
  if (role.key === "gerencia" && !permissionKeys.includes("settings.manage")) throw conflict("Gerencia debe conservar la administración de la configuración");
  const before = await ctx.tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await ctx.tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionKeys.length) await ctx.tx.insert(rolePermissions).values(permissionKeys.map((p) => ({ roleId, permissionKey: p })));
  await audit(ctx, { action: "role.permissions", entityType: "role", entityId: roleId, summary: `Permisos del rol ${role.name} actualizados (${permissionKeys.length})`, before: before.map((b) => b.permissionKey), after: permissionKeys });
}

export async function setRoleNotification(ctx: Ctx, roleId: string, type: string, enabled: boolean) {
  requirePerm(ctx, "settings.manage");
  await ctx.tx.insert(notificationRules).values({ roleId, type, enabled }).onConflictDoUpdate({ target: [notificationRules.roleId, notificationRules.type], set: { enabled } });
  await audit(ctx, { action: "role.notification", entityType: "role", entityId: roleId, summary: `Notificación "${type}" ${enabled ? "activada" : "desactivada"}` });
}

export async function countUsers(ctx: Ctx) {
  const [r] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.isActive, true)));
  return r.n;
}

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { roles, userRoles, users, employees } from "@/server/db/schema";
import { systemActor, withCtx, type Actor, type Ctx } from "@/server/ctx";
import { hashPassword, loadActor } from "@/server/auth/core";
import { normalizeName } from "@/lib/text";

export const uniq = (p = "T") => `${p} ${randomUUID().slice(0, 8)}`;

export function asSystem<T>(fn: (ctx: Ctx) => Promise<T>, now?: Date) {
  return withCtx(systemActor("tests"), fn, { now });
}

export function as<T>(actor: Actor, fn: (ctx: Ctx) => Promise<T>, now?: Date) {
  return withCtx(actor, fn, { now });
}

/** Crea un usuario con rol (y colaborador vinculado) y devuelve su Actor real cargado desde la BD. */
export async function makeUser(roleKey: string, opts: { name?: string; source?: Actor["source"] } = {}) {
  const name = opts.name ?? uniq(roleKey);
  const userId = await asSystem(async ({ tx }) => {
    const [emp] = await tx
      .insert(employees)
      .values({ fullName: name, normalizedName: normalizeName(name), startDate: "2026-01-01" })
      .returning();
    const [u] = await tx
      .insert(users)
      .values({ email: `${randomUUID().slice(0, 8)}@test.local`, name, passwordHash: await hashPassword("x"), employeeId: emp.id })
      .returning();
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey));
    await tx.insert(userRoles).values({ userId: u.id, roleId: role.id });
    return u.id;
  });
  const actor = await loadActor(userId, opts.source ?? "ui");
  if (!actor) throw new Error("no actor");
  return actor;
}

export const at = (iso: string) => new Date(`${iso}T15:00:00Z`); // 9:00 a. m. en Managua

export const standardContract = (overrides: Record<string, unknown> = {}) => ({
  startDate: "2026-10-12",
  monthlyPrice: 12000,
  currency: "NIO",
  billingDay: 15,
  socialNetworks: ["facebook", "instagram"],
  ...overrides,
});

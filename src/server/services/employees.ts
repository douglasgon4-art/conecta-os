import { and, asc, desc, eq, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  employeeChanges,
  employeeSalaryHistory,
  employees,
  payrollPeriods,
  payrollRecords,
  users,
} from "../db/schema";
import { audit, can, requirePerm, type Ctx } from "../ctx";
import { AppError, notFound } from "../errors";
import { Loose, parse, zCurrency, zDate, zEmail, zMoney, zRequiredDate, zRequiredText, zText } from "../validation";
import { normalizeName, phoneDigits } from "@/lib/text";
import { CONTRACT_TYPES, DEPARTMENTS, EMPLOYEE_STATUSES, PAY_FREQUENCIES, values } from "@/lib/domain";

export const employeeInput = z.object({
  fullName: zRequiredText(150),
  phone: zText(40),
  email: zEmail(),
  position: zText(100),
  departmentKey: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(DEPARTMENTS)).optional()),
  hireDate: zDate(),
  startDate: zRequiredDate(),
  salary: z.preprocess((v) => (v === "" || v === null ? undefined : v), zMoney().optional()),
  currency: zCurrency(),
  payFrequency: z.enum(values(PAY_FREQUENCIES)).default("quincenal"),
  contractType: z.enum(values(CONTRACT_TYPES)).default("indeterminado"),
  workSchedule: zText(100),
  managerId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  notes: zText(2000),
});
export type EmployeeInput = Loose<typeof employeeInput>;

export async function findEmployeeDuplicates(
  ctx: Ctx,
  data: { fullName: string; email?: string | null; phone?: string | null },
  excludeId?: string,
) {
  const conds = [eq(employees.normalizedName, normalizeName(data.fullName))];
  if (data.email) conds.push(sql`lower(${employees.email}) = lower(${data.email})`);
  const digits = phoneDigits(data.phone);
  if (digits) conds.push(sql`right(regexp_replace(coalesce(${employees.phone}, ''), '\\D', '', 'g'), 8) = ${digits}`);
  const rows = await ctx.tx
    .select({ id: employees.id, fullName: employees.fullName, email: employees.email, phone: employees.phone, status: employees.status })
    .from(employees)
    .where(or(...conds));
  return rows.filter((r) => r.id !== excludeId);
}

export async function createEmployee(ctx: Ctx, raw: EmployeeInput, opts: { allowDuplicate?: boolean } = {}) {
  requirePerm(ctx, "employees.write");
  const input = parse(employeeInput, raw);
  if (input.salary !== undefined) requirePerm(ctx, "employees.salary");

  if (!opts.allowDuplicate) {
    const dups = await findEmployeeDuplicates(ctx, input);
    if (dups.length) {
      throw new AppError("DUPLICATE", `Ya existe un colaborador que coincide: ${dups.map((d) => d.fullName).join(", ")}`, {
        candidates: dups,
      });
    }
  }

  const [emp] = await ctx.tx
    .insert(employees)
    .values({
      fullName: input.fullName,
      normalizedName: normalizeName(input.fullName),
      phone: input.phone ?? null,
      email: input.email ?? null,
      position: input.position ?? null,
      departmentKey: input.departmentKey ?? null,
      hireDate: input.hireDate ?? input.startDate,
      startDate: input.startDate,
      payFrequency: input.payFrequency,
      contractType: input.contractType,
      workSchedule: input.workSchedule ?? null,
      managerId: input.managerId ?? null,
      notes: input.notes ?? null,
      createdBy: ctx.actor.userId,
    })
    .returning();

  if (input.salary !== undefined) {
    await ctx.tx.insert(employeeSalaryHistory).values({
      employeeId: emp.id,
      salary: input.salary,
      currency: input.currency,
      effectiveDate: input.startDate,
      reason: "Salario inicial",
      changedBy: ctx.actor.userId,
    });
  }

  await audit(ctx, {
    action: "employee.create",
    entityType: "employee",
    entityId: emp.id,
    summary: `Colaborador creado: ${emp.fullName}`,
    after: { ...emp, salary: input.salary ?? null, currency: input.currency },
  });
  return { ...emp, salary: input.salary ?? null, currency: input.salary !== undefined ? input.currency : null };
}

const TRACKED_FIELDS = ["position", "departmentKey", "workSchedule", "status", "contractType", "payFrequency", "managerId"] as const;

export const employeeUpdateInput = employeeInput
  .omit({ salary: true, currency: true, startDate: true })
  .partial()
  .extend({
    status: z.enum(values(EMPLOYEE_STATUSES)).optional(),
    terminationDate: zDate(),
    effectiveDate: zDate(),
  });

export async function updateEmployee(ctx: Ctx, id: string, raw: Loose<typeof employeeUpdateInput>) {
  requirePerm(ctx, "employees.write");
  const input = parse(employeeUpdateInput, raw);
  const [before] = await ctx.tx.select().from(employees).where(eq(employees.id, id));
  if (!before) throw notFound("Colaborador");
  if (input.status === "baja" && !input.terminationDate && !before.terminationDate) {
    throw new AppError("VALIDATION", "Para dar de baja a un colaborador indica la fecha de terminación");
  }
  const effectiveDate = input.effectiveDate ?? ctx.today;
  const patch: Partial<typeof employees.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "effectiveDate" || v === undefined) continue;
    (patch as Record<string, unknown>)[k] = v;
  }
  if (input.fullName) patch.normalizedName = normalizeName(input.fullName);
  if (!Object.keys(patch).length) return before;

  const [after] = await ctx.tx.update(employees).set(patch).where(eq(employees.id, id)).returning();
  const changes = TRACKED_FIELDS.filter((f) => (patch as Record<string, unknown>)[f] !== undefined && before[f] !== after[f]);
  if (changes.length) {
    await ctx.tx.insert(employeeChanges).values(
      changes.map((f) => ({
        employeeId: id,
        field: f,
        oldValue: before[f] == null ? null : String(before[f]),
        newValue: after[f] == null ? null : String(after[f]),
        effectiveDate,
        changedBy: ctx.actor.userId,
      })),
    );
  }
  await audit(ctx, {
    action: "employee.update",
    entityType: "employee",
    entityId: id,
    summary: `Colaborador actualizado: ${after.fullName}`,
    before,
    after,
  });
  return after;
}

export const salaryChangeInput = z.object({
  salary: zMoney(),
  currency: zCurrency(),
  effectiveDate: zRequiredDate(),
  reason: zText(300),
});

/**
 * Registra un cambio salarial con fecha efectiva. Nunca sobrescribe el historial.
 * Si la fecha efectiva cae dentro de nóminas ya cerradas exige confirmación explícita
 * (las nóminas cerradas no se recalculan; la diferencia se gestiona con un ajuste autorizado).
 */
export async function changeSalary(
  ctx: Ctx,
  employeeId: string,
  raw: Loose<typeof salaryChangeInput>,
  opts: { confirmRetroactive?: boolean } = {},
) {
  requirePerm(ctx, "employees.salary");
  const input = parse(salaryChangeInput, raw);
  const [emp] = await ctx.tx.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) throw notFound("Colaborador");

  // Lectura elevada: quien cambia salarios puede no tener permiso de nómina, pero el control debe ver las nóminas cerradas.
  const closed = await ctx.elevate(() => ctx.tx
    .select({ id: payrollPeriods.id, periodEnd: payrollPeriods.periodEnd, status: payrollPeriods.status })
    .from(payrollPeriods)
    .innerJoin(payrollRecords, eq(payrollRecords.periodId, payrollPeriods.id))
    .where(
      and(
        eq(payrollRecords.employeeId, employeeId),
        inArray(payrollPeriods.status, ["aprobada", "contabilizada", "pagada"]),
        sql`${payrollPeriods.periodEnd} >= ${input.effectiveDate}`,
      ),
    ));
  const isRetroactive = input.effectiveDate < ctx.today || closed.length > 0;
  if (isRetroactive && !opts.confirmRetroactive) {
    throw new AppError(
      "CONFIRMATION_REQUIRED",
      closed.length
        ? `El cambio es retroactivo y afecta ${closed.length} nómina(s) cerrada(s), que no se recalcularán. ¿Confirmas?`
        : "El cambio salarial es retroactivo. ¿Confirmas?",
      { closedPayrolls: closed.length },
    );
  }

  const previous = await currentSalary(ctx, employeeId, input.effectiveDate);
  const [row] = await ctx.tx
    .insert(employeeSalaryHistory)
    .values({
      employeeId,
      salary: input.salary,
      currency: input.currency,
      effectiveDate: input.effectiveDate,
      reason: input.reason ?? null,
      changedBy: ctx.actor.userId,
    })
    .returning();
  await audit(ctx, {
    action: "employee.salary_change",
    entityType: "employee",
    entityId: employeeId,
    summary: `Salario de ${emp.fullName}: ${previous?.salary ?? "—"} → ${input.salary} ${input.currency} desde ${input.effectiveDate}`,
    before: previous,
    after: row,
  });
  return row;
}

export async function currentSalary(ctx: Ctx, employeeId: string, onDate?: string) {
  const [row] = await ctx.tx
    .select()
    .from(employeeSalaryHistory)
    .where(and(eq(employeeSalaryHistory.employeeId, employeeId), lte(employeeSalaryHistory.effectiveDate, onDate ?? ctx.today)))
    .orderBy(desc(employeeSalaryHistory.effectiveDate))
    .limit(1);
  return row ?? null;
}

export async function listEmployees(ctx: Ctx, opts: { q?: string; status?: string; includeSalary?: boolean } = {}) {
  requirePerm(ctx, "employees.read", "tasks.write", "production.manage", "clients.write", "publications.manage", "leads.write", "sessions.write", "strategy.write");
  const conds = [];
  if (opts.status) conds.push(eq(employees.status, opts.status));
  if (opts.q) conds.push(or(ilike(employees.fullName, `%${opts.q}%`), ilike(employees.email, `%${opts.q}%`), ilike(employees.position, `%${opts.q}%`)));
  const rows = await ctx.tx
    .select()
    .from(employees)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(employees.fullName));
  if (!(opts.includeSalary && can(ctx, "employees.salary"))) return rows.map((r) => ({ ...r, salary: null as number | null, currency: null as string | null }));
  const salaries = await ctx.tx.execute<{ employee_id: string; salary: string; currency: string }>(sql`
    select distinct on (employee_id) employee_id, salary, currency from employee_salary_history
    where effective_date <= ${ctx.today} order by employee_id, effective_date desc`);
  const map = new Map(salaries.rows.map((s) => [s.employee_id, s]));
  return rows.map((r) => ({ ...r, salary: map.has(r.id) ? Number(map.get(r.id)!.salary) : null, currency: map.get(r.id)?.currency ?? null }));
}

/** Lista mínima para selectores de responsables (sin datos sensibles). */
export async function listAssignableEmployees(ctx: Ctx) {
  return ctx.tx
    .select({ id: employees.id, fullName: employees.fullName, departmentKey: employees.departmentKey, position: employees.position })
    .from(employees)
    .where(eq(employees.status, "activo"))
    .orderBy(asc(employees.fullName));
}

export async function getEmployee(ctx: Ctx, id: string) {
  const isSelf = ctx.actor.employeeId === id;
  if (!isSelf) requirePerm(ctx, "employees.read");
  const [emp] = await ctx.tx.select().from(employees).where(eq(employees.id, id));
  if (!emp) throw notFound("Colaborador");
  const changes = await ctx.tx.select().from(employeeChanges).where(eq(employeeChanges.employeeId, id)).orderBy(desc(employeeChanges.createdAt));
  const salaryHistory = can(ctx, "employees.salary")
    ? await ctx.tx.select().from(employeeSalaryHistory).where(eq(employeeSalaryHistory.employeeId, id)).orderBy(desc(employeeSalaryHistory.effectiveDate))
    : null;
  const [user] = await ctx.tx.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users).where(eq(users.employeeId, id));
  const current = salaryHistory?.find((s) => s.effectiveDate <= ctx.today) ?? null;
  return { ...emp, changes, salaryHistory, currentSalary: current, user: user ?? null };
}

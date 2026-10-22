import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { budgets, clients, expenseCategories, expensePayments, expenses, recurringExpenses } from "../db/schema";
import { audit, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, notFound } from "../errors";
import { Loose, parse, zCurrency, zDate, zInt, zPositiveMoney, zRequiredDate, zRequiredText, zText, zUuid } from "../validation";
import { addDays, addMonths, firstOfMonth, formatPeriod, lastOfMonth, maxDate, monthsBetween, withDay } from "@/lib/dates";
import { PAYMENT_METHODS, values } from "@/lib/domain";
import { round2, toBase } from "@/lib/money";
import { getSettings } from "./settings";

type Expense = typeof expenses.$inferSelect;

export function expenseStatus(e: Pick<Expense, "status" | "amount" | "paidAmount" | "dueDate">, today: string) {
  const balance = round2(e.amount - e.paidAmount);
  if (e.status === "anulado") return { status: "anulado" as const, balance: 0, overdue: false, partial: false };
  if (balance <= 0) return { status: "pagado" as const, balance: 0, overdue: false, partial: false };
  const overdue = !!e.dueDate && e.dueDate < today;
  const partial = e.paidAmount > 0;
  return { status: overdue ? ("vencido" as const) : partial ? ("parcial" as const) : ("pendiente" as const), balance, overdue, partial };
}

export async function listCategories(ctx: Ctx) {
  return ctx.tx.select().from(expenseCategories).where(eq(expenseCategories.isActive, true)).orderBy(asc(expenseCategories.name));
}

async function resolveCategory(ctx: Ctx, idOrKey: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
  const [cat] = await ctx.tx
    .select()
    .from(expenseCategories)
    .where(isUuid ? eq(expenseCategories.id, idOrKey) : or(eq(expenseCategories.key, idOrKey), ilike(expenseCategories.name, idOrKey)));
  if (!cat) throw new AppError("VALIDATION", `Categoría de gasto desconocida: ${idOrKey}`);
  return cat;
}

export const expenseInput = z.object({
  name: zRequiredText(200),
  category: zRequiredText(80), // id, clave o nombre
  supplier: zText(150),
  description: zText(2000),
  amount: zPositiveMoney(),
  currency: zCurrency(),
  registeredAt: zDate(),
  dueDate: zDate(),
  accountingDate: zDate(),
  paymentMethod: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(PAYMENT_METHODS)).optional()),
  receiptAssetId: zUuid(),
  clientId: zUuid(),
  department: zText(50),
  notes: zText(2000),
});

/** Registra un gasto único. Bloquea duplicados evidentes y gastos manuales de nómina (los genera el módulo laboral). */
export async function createExpense(ctx: Ctx, raw: Loose<typeof expenseInput>, opts: { allowDuplicate?: boolean; confirmPayrollManual?: boolean } = {}) {
  requirePerm(ctx, "expenses.write");
  const input = parse(expenseInput, raw);
  const cat = await resolveCategory(ctx, input.category);
  if (cat.kind === "nomina" && !opts.confirmPayrollManual) {
    throw new AppError("CONFIRMATION_REQUIRED", `Los gastos de "${cat.name}" se generan al contabilizar la nómina. Registrarlo a mano podría duplicarlo. ¿Confirmas que no proviene de una nómina?`);
  }
  const registeredAt = input.registeredAt ?? ctx.today;
  const accountingDate = input.accountingDate ?? input.dueDate ?? registeredAt;
  if (!opts.allowDuplicate) {
    const dup = await ctx.tx
      .select({ id: expenses.id, name: expenses.name, accountingDate: expenses.accountingDate })
      .from(expenses)
      .where(
        and(
          eq(expenses.categoryId, cat.id),
          eq(expenses.amount, input.amount),
          eq(expenses.currency, input.currency),
          sql`${expenses.status} <> 'anulado'`,
          gte(expenses.accountingDate, firstOfMonth(accountingDate)),
          lte(expenses.accountingDate, lastOfMonth(accountingDate)),
          or(ilike(expenses.name, input.name), input.supplier ? ilike(expenses.supplier, input.supplier) : sql`false`),
        ),
      );
    if (dup.length) throw new AppError("DUPLICATE", `Ya existe un gasto similar este mes: ${dup.map((d) => d.name).join(", ")}`, { candidates: dup });
  }
  const [row] = await ctx.tx
    .insert(expenses)
    .values({
      name: input.name,
      categoryId: cat.id,
      supplier: input.supplier ?? null,
      description: input.description ?? null,
      amount: input.amount,
      currency: input.currency,
      registeredAt,
      dueDate: input.dueDate ?? null,
      accountingDate,
      paymentMethod: input.paymentMethod ?? null,
      receiptAssetId: input.receiptAssetId ?? null,
      clientId: input.clientId ?? null,
      department: input.department ?? null,
      notes: input.notes ?? null,
      createdBy: ctx.actor.userId,
    })
    .returning();
  await audit(ctx, { action: "expense.create", entityType: "expense", entityId: row.id, clientId: row.clientId, summary: `Gasto registrado: ${row.name} · ${cat.name} · ${row.amount} ${row.currency}`, after: row });
  return { ...row, categoryName: cat.name };
}

export const expensePaymentInput = z.object({
  amount: zPositiveMoney().optional(),
  paidAt: zRequiredDate(),
  method: z.enum(values(PAYMENT_METHODS)),
  reference: zText(200),
  receiptAssetId: zUuid(),
  notes: zText(1000),
  idempotencyKey: zText(100),
});

/** Registra un pago (total o parcial). Sin importe, paga el saldo pendiente completo. */
export async function recordExpensePayment(ctx: Ctx, expenseId: string, raw: Loose<typeof expensePaymentInput>) {
  requirePerm(ctx, "expenses.pay");
  const input = parse(expensePaymentInput, raw);
  if (input.idempotencyKey) {
    const [prev] = await ctx.tx.select().from(expensePayments).where(eq(expensePayments.idempotencyKey, input.idempotencyKey));
    if (prev) return { payment: prev, expense: (await ctx.tx.select().from(expenses).where(eq(expenses.id, expenseId)))[0], duplicate: true };
  }
  const [e] = await ctx.tx.select().from(expenses).where(eq(expenses.id, expenseId)).for("update");
  if (!e) throw notFound("Gasto");
  if (e.status === "anulado") throw conflict("El gasto está anulado");
  const balance = round2(e.amount - e.paidAmount);
  if (balance <= 0) throw conflict(`El gasto "${e.name}" ya está pagado`);
  const amount = input.amount ?? balance;
  if (amount > balance) throw new AppError("VALIDATION", `El pago (${amount}) excede el saldo pendiente (${balance} ${e.currency})`);
  const [payment] = await ctx.tx
    .insert(expensePayments)
    .values({ expenseId, amount, paidAt: input.paidAt, method: input.method, reference: input.reference ?? null, receiptAssetId: input.receiptAssetId ?? null, notes: input.notes ?? null, idempotencyKey: input.idempotencyKey ?? null, createdBy: ctx.actor.userId })
    .returning();
  const paid = round2(e.paidAmount + amount);
  const [after] = await ctx.tx
    .update(expenses)
    .set({ paidAmount: paid, status: paid >= e.amount ? "pagado" : "parcial", paymentMethod: e.paymentMethod ?? input.method })
    .where(eq(expenses.id, expenseId))
    .returning();
  await audit(ctx, { action: "expense.payment", entityType: "expense", entityId: expenseId, clientId: e.clientId, summary: `Pago de gasto "${e.name}": ${amount} ${e.currency}. Saldo: ${round2(after.amount - after.paidAmount)}`, before: e, after: { expense: after, payment } });
  return { payment, expense: after, duplicate: false };
}

export async function voidExpense(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "expenses.write");
  if (!reason?.trim()) throw new AppError("VALIDATION", "Indica el motivo de la anulación");
  const [e] = await ctx.tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
  if (!e) throw notFound("Gasto");
  if (e.paidAmount > 0) throw conflict("No se puede anular un gasto con pagos registrados");
  if (e.sourceType === "nomina") throw conflict("Los gastos de nómina se gestionan desde el módulo de nómina");
  const [after] = await ctx.tx.update(expenses).set({ status: "anulado", voidReason: reason }).where(eq(expenses.id, id)).returning();
  await audit(ctx, { action: "expense.void", entityType: "expense", entityId: id, summary: `Gasto anulado: ${e.name}. Motivo: ${reason}`, before: e, after });
  return after;
}

export async function listExpenses(ctx: Ctx, f: { period?: string; category?: string; supplier?: string; status?: string; currency?: string; q?: string } = {}) {
  requirePerm(ctx, "expenses.read");
  const conds = [];
  if (f.period) conds.push(gte(expenses.accountingDate, firstOfMonth(f.period)), lte(expenses.accountingDate, lastOfMonth(f.period)));
  if (f.category) conds.push(eq(expenses.categoryId, (await resolveCategory(ctx, f.category)).id));
  if (f.supplier) conds.push(ilike(expenses.supplier, `%${f.supplier}%`));
  if (f.currency) conds.push(eq(expenses.currency, f.currency));
  if (f.q) conds.push(or(ilike(expenses.name, `%${f.q}%`), ilike(expenses.supplier, `%${f.q}%`)));
  if (f.status === "abiertos") conds.push(inArray(expenses.status, ["pendiente", "parcial"]));
  const rows = await ctx.tx
    .select({ e: expenses, categoryName: expenseCategories.name, categoryKind: expenseCategories.kind, clientName: clients.tradeName })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(clients, eq(clients.id, expenses.clientId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(expenses.accountingDate), asc(expenses.name));
  return rows
    .map((r) => ({ ...r.e, categoryName: r.categoryName, categoryKind: r.categoryKind, clientName: r.clientName, ...expenseStatus(r.e, ctx.today) }))
    .filter((r) => !f.status || f.status === "abiertos" || r.status === f.status);
}

export async function getExpense(ctx: Ctx, id: string) {
  requirePerm(ctx, "expenses.read");
  const [row] = await ctx.tx
    .select({ e: expenses, categoryName: expenseCategories.name })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(eq(expenses.id, id));
  if (!row) throw notFound("Gasto");
  const payments = await ctx.tx.select().from(expensePayments).where(eq(expensePayments.expenseId, id)).orderBy(asc(expensePayments.paidAt));
  return { ...row.e, categoryName: row.categoryName, payments, ...expenseStatus(row.e, ctx.today) };
}

/** Busca gastos abiertos por nombre o proveedor (p. ej. "el alquiler del local") para registrar su pago. */
export async function findOpenExpenses(ctx: Ctx, q: string) {
  requirePerm(ctx, "expenses.read");
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  const conds = words.length ? words.map((w) => or(ilike(expenses.name, `%${w}%`), ilike(expenses.supplier, `%${w}%`), ilike(expenseCategories.name, `%${w}%`))) : [ilike(expenses.name, `%${q}%`)];
  const rows = await ctx.tx
    .select({ e: expenses, categoryName: expenseCategories.name })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(inArray(expenses.status, ["pendiente", "parcial"]), or(...conds)))
    .orderBy(asc(expenses.dueDate));
  return rows.map((r) => ({ ...r.e, categoryName: r.categoryName, ...expenseStatus(r.e, ctx.today) }));
}

// ───────────────────────── Recurrentes ─────────────────────────

export const recurringInput = z.object({
  name: zRequiredText(200),
  category: zRequiredText(80),
  supplier: zText(150),
  description: zText(2000),
  amount: zPositiveMoney(),
  currency: zCurrency(),
  dayOfMonth: zInt(1, 28).default(1),
  intervalMonths: zInt(1, 12).default(1),
  startDate: zRequiredDate(),
  endDate: zDate(),
  paymentMethod: z.preprocess((v) => (v === "" ? undefined : v), z.enum(values(PAYMENT_METHODS)).optional()),
  clientId: zUuid(),
  department: zText(50),
  notes: zText(2000),
});

export async function createRecurringExpense(ctx: Ctx, raw: Loose<typeof recurringInput>) {
  requirePerm(ctx, "expenses.write");
  const input = parse(recurringInput, raw);
  const cat = await resolveCategory(ctx, input.category);
  if (input.endDate && input.endDate < input.startDate) throw new AppError("VALIDATION", "La fecha de fin es anterior al inicio");
  const [rec] = await ctx.tx
    .insert(recurringExpenses)
    .values({ ...input, categoryId: cat.id, supplier: input.supplier ?? null, description: input.description ?? null, endDate: input.endDate ?? null, paymentMethod: input.paymentMethod ?? null, clientId: input.clientId ?? null, department: input.department ?? null, notes: input.notes ?? null, createdBy: ctx.actor.userId })
    .returning();
  await audit(ctx, { action: "recurring.create", entityType: "recurring_expense", entityId: rec.id, summary: `Gasto recurrente creado: ${rec.name} · ${rec.amount} ${rec.currency} cada ${rec.intervalMonths} mes(es)` });
  const generated = await generateRecurringExpenses(ctx, { recurringId: rec.id });
  return { recurring: rec, generated };
}

export async function updateRecurringExpense(ctx: Ctx, id: string, raw: Loose<typeof recurringInput>) {
  requirePerm(ctx, "expenses.write");
  const input = parse(recurringInput.partial(), raw);
  const [before] = await ctx.tx.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
  if (!before) throw notFound("Gasto recurrente");
  const patch: Partial<typeof recurringExpenses.$inferInsert> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined && k !== "category") (patch as Record<string, unknown>)[k] = v;
  if (input.category) patch.categoryId = (await resolveCategory(ctx, input.category)).id;
  const [after] = await ctx.tx.update(recurringExpenses).set(patch).where(eq(recurringExpenses.id, id)).returning();
  await audit(ctx, { action: "recurring.update", entityType: "recurring_expense", entityId: id, summary: `Gasto recurrente actualizado: ${after.name} (aplica a los próximos períodos)`, before, after });
  return after;
}

/** Pausar, reanudar o cancelar. Los registros ya generados y pagados no se tocan; los futuros pendientes se anulan al cancelar. */
export async function setRecurringStatus(ctx: Ctx, id: string, status: "activa" | "pausada" | "cancelada") {
  requirePerm(ctx, "expenses.write");
  const [before] = await ctx.tx.select().from(recurringExpenses).where(eq(recurringExpenses.id, id));
  if (!before) throw notFound("Gasto recurrente");
  if (before.status === "cancelada") throw conflict("La recurrencia está cancelada");
  const [after] = await ctx.tx.update(recurringExpenses).set({ status, ...(status === "cancelada" ? { endDate: ctx.today } : {}) }).where(eq(recurringExpenses.id, id)).returning();
  let voided = 0;
  if (status !== "activa") {
    const r = await ctx.tx
      .update(expenses)
      .set({ status: "anulado", voidReason: `Recurrencia ${status}` })
      .where(and(eq(expenses.recurringId, id), eq(expenses.status, "pendiente"), eq(expenses.paidAmount, 0), sql`${expenses.accountingDate} > ${ctx.today}`))
      .returning({ id: expenses.id });
    voided = r.length;
  }
  await audit(ctx, { action: "recurring.status", entityType: "recurring_expense", entityId: id, summary: `Recurrencia "${before.name}": ${before.status} → ${status}${voided ? ` (${voided} gasto(s) futuro(s) anulado(s))` : ""}`, before, after });
  return { recurring: after, voided };
}

export async function listRecurringExpenses(ctx: Ctx) {
  requirePerm(ctx, "expenses.read");
  return ctx.tx
    .select({ r: recurringExpenses, categoryName: expenseCategories.name })
    .from(recurringExpenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, recurringExpenses.categoryId))
    .orderBy(asc(recurringExpenses.status), asc(recurringExpenses.name));
}

/**
 * Genera los gastos de cada recurrencia activa para el mes actual y los siguientes (según la anticipación),
 * sin duplicar (source_key único) y siempre como pendientes.
 */
export async function generateRecurringExpenses(ctx: Ctx, opts: { recurringId?: string } = {}) {
  const settings = await getSettings(ctx);
  const conds = [eq(recurringExpenses.status, "activa")];
  if (opts.recurringId) conds.push(eq(recurringExpenses.id, opts.recurringId));
  const list = await ctx.tx.select().from(recurringExpenses).where(and(...conds));
  const curP = firstOfMonth(ctx.today);
  const lastP = addMonths(curP, settings.cycle_lookahead_months);
  let created = 0;
  for (const rec of list) {
    const startP = firstOfMonth(rec.startDate);
    for (let p = maxDate(startP, curP)!; p <= lastP; p = addMonths(p, 1)) {
      if (monthsBetween(startP, p) % rec.intervalMonths !== 0) continue;
      const due = withDay(p, rec.dayOfMonth);
      if (due < rec.startDate) continue;
      if (rec.endDate && due > rec.endDate) break;
      const res = await ctx.tx
        .insert(expenses)
        .values({
          name: `${rec.name} — ${formatPeriod(p)}`,
          categoryId: rec.categoryId,
          supplier: rec.supplier,
          description: rec.description,
          amount: rec.amount,
          currency: rec.currency,
          registeredAt: ctx.today,
          dueDate: due,
          accountingDate: due,
          paymentMethod: rec.paymentMethod,
          clientId: rec.clientId,
          department: rec.department,
          sourceType: "recurrente",
          recurringId: rec.id,
          sourceKey: `recurring:${rec.id}:${p}`,
          createdBy: ctx.actor.userId,
        })
        .onConflictDoNothing()
        .returning({ id: expenses.id });
      created += res.length;
    }
  }
  return created;
}

export async function setBudget(ctx: Ctx, raw: { category: string; period: string; amount: number; currency?: string }) {
  requirePerm(ctx, "expenses.write");
  const cat = await resolveCategory(ctx, raw.category);
  const amount = parse(zPositiveMoney(), raw.amount);
  const period = firstOfMonth(raw.period);
  const currency = raw.currency ?? "NIO";
  await ctx.tx.insert(budgets).values({ categoryId: cat.id, period, amount, currency }).onConflictDoUpdate({ target: [budgets.categoryId, budgets.period, budgets.currency], set: { amount } });
  await audit(ctx, { action: "budget.set", entityType: "budget", summary: `Presupuesto ${cat.name} ${formatPeriod(period)}: ${amount} ${currency}` });
}

// ───────────────────────── Resumen ─────────────────────────

type ByCurrency = Record<string, number>;
const addTo = (acc: ByCurrency, cur: string, v: number) => ((acc[cur] = round2((acc[cur] ?? 0) + v)), acc);

/** Panel "Gastos del mes": devengado, pagado, pendiente, vencido, por categoría, comparación y presupuesto. */
export async function expensesSummary(ctx: Ctx, periodInput: string) {
  requirePerm(ctx, "expenses.read");
  const settings = await getSettings(ctx);
  const rate = settings.exchange_rate_usd_nio;
  const base = settings.base_currency;
  const period = firstOfMonth(periodInput);
  const list = (await listExpenses(ctx, { period })).filter((e) => e.status !== "anulado");
  const prev = (await listExpenses(ctx, { period: addMonths(period, -1) })).filter((e) => e.status !== "anulado");
  const total: ByCurrency = {}, paid: ByCurrency = {}, pending: ByCurrency = {}, overdue: ByCurrency = {};
  const byCategory = new Map<string, { name: string; kind: string; amount: number }>();
  for (const e of list) {
    addTo(total, e.currency, e.amount);
    addTo(paid, e.currency, e.paidAmount);
    addTo(pending, e.currency, e.balance);
    if (e.overdue) addTo(overdue, e.currency, e.balance);
    const c = byCategory.get(e.categoryName) ?? { name: e.categoryName, kind: e.categoryKind, amount: 0 };
    c.amount = round2(c.amount + toBase(e.amount, e.currency, rate, base));
    byCategory.set(e.categoryName, c);
  }
  const conv = (m: ByCurrency) => round2(Object.entries(m).reduce((a, [cur, v]) => a + toBase(v, cur, rate, base), 0));
  const prevTotal = round2(prev.reduce((a, e) => a + toBase(e.amount, e.currency, rate, base), 0));
  // Salidas de caja reales del mes (pagos con fecha en el período), independientemente del mes contable del gasto.
  const cash = await ctx.tx
    .select({ amount: expensePayments.amount, currency: expenses.currency })
    .from(expensePayments)
    .innerJoin(expenses, eq(expenses.id, expensePayments.expenseId))
    .where(and(gte(expensePayments.paidAt, period), lte(expensePayments.paidAt, lastOfMonth(period))));
  const cashOut: ByCurrency = {};
  cash.forEach((c) => addTo(cashOut, c.currency, c.amount));
  const upcoming = (await listExpenses(ctx, { status: "abiertos" }))
    .filter((e) => e.dueDate && e.dueDate >= ctx.today && e.dueDate <= addDays(ctx.today, 15))
    .slice(0, 20);
  const budgetRows = await ctx.tx
    .select({ b: budgets, name: expenseCategories.name })
    .from(budgets)
    .innerJoin(expenseCategories, eq(expenseCategories.id, budgets.categoryId))
    .where(eq(budgets.period, period));
  const budget = budgetRows.map((b) => ({ category: b.name, budget: toBase(b.b.amount, b.b.currency, rate, base), actual: byCategory.get(b.name)?.amount ?? 0 }));
  const recurringCount = (await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(recurringExpenses).where(eq(recurringExpenses.status, "activa")))[0].n;
  return {
    period,
    base,
    rate,
    total,
    paid,
    pending,
    overdue,
    cashOut,
    totalBase: conv(total),
    paidBase: conv(paid),
    pendingBase: conv(pending),
    overdueBase: conv(overdue),
    cashOutBase: conv(cashOut),
    previousTotalBase: prevTotal,
    changeVsPrevious: prevTotal ? (conv(total) - prevTotal) / prevTotal : null,
    byCategory: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
    upcoming,
    budget,
    recurringCount,
    count: list.length,
  };
}

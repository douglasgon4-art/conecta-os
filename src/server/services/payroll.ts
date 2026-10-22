import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  employeeSalaryHistory,
  employees,
  expenseCategories,
  expenses,
  laborBenefitAccruals,
  laborRuleSets,
  leaveAdjustments,
  payrollAdjustments,
  payrollPeriods,
  payrollRecords,
  vacationRequests,
  type LaborRuleParams,
} from "../db/schema";
import { audit, can, requirePerm, type Ctx } from "../ctx";
import { AppError, conflict, forbidden, notFound } from "../errors";
import { parse, zPositiveMoney, zRequiredDate, zRequiredText, zText } from "../validation";
import { addDays, addMonths, daysInMonth, firstOfMonth, formatDate, lastOfMonth, makeISO, parseISO } from "@/lib/dates";
import { round2, sum } from "@/lib/money";
import { notify } from "./notifications";

type RuleSet = typeof laborRuleSets.$inferSelect;
type Employee = typeof employees.$inferSelect;
type SalaryRow = typeof employeeSalaryHistory.$inferSelect;

// ───────────────────────── Calendario comercial (mes de 30 días) ─────────────────────────

/** Días comerciales entre dos fechas inclusivas (método 30/360). */
export function commercialDays(from: string, to: string): number {
  if (to < from) return 0;
  const a = parseISO(from);
  const b = parseISO(to);
  const d1 = Math.min(a.d, 30);
  // El último día del mes cuenta como día 30 (febrero incluido).
  const d2 = b.d === daysInMonth(b.y, b.m) ? 30 : Math.min(b.d, 30);
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1) + 1;
}

/** Quincenas de un mes: 1–15 y 16–fin. */
export function fortnightsOf(period: string) {
  const { y, m } = parseISO(period);
  return [
    { periodStart: makeISO(y, m, 1), periodEnd: makeISO(y, m, 15), payDate: makeISO(y, m, 15) },
    { periodStart: makeISO(y, m, 16), periodEnd: lastOfMonth(period), payDate: lastOfMonth(period) },
  ];
}

// ───────────────────────── Reglas laborales versionadas ─────────────────────────

export async function getRuleSet(ctx: Ctx, onDate: string): Promise<RuleSet> {
  const [r] = await ctx.tx
    .select()
    .from(laborRuleSets)
    .where(and(lte(laborRuleSets.effectiveFrom, onDate), or(isNull(laborRuleSets.effectiveTo), gte(laborRuleSets.effectiveTo, onDate))))
    .orderBy(desc(laborRuleSets.effectiveFrom))
    .limit(1);
  if (!r) throw new AppError("NOT_CONFIGURED", `No hay reglas laborales vigentes para ${formatDate(onDate)}. Configúralas en Configuración → Reglas laborales.`);
  return r;
}

export async function listRuleSets(ctx: Ctx) {
  requirePerm(ctx, "payroll.read", "settings.manage");
  return ctx.tx.select().from(laborRuleSets).orderBy(desc(laborRuleSets.effectiveFrom));
}

const bracket = z.object({ from: z.number().min(0), to: z.number().nullable(), base: z.number().min(0), rate: z.number().min(0).max(1) });
export const ruleParamsSchema = z.object({
  inssEmployeeRate: z.number().min(0).max(1),
  inssEmployerRate: z.number().min(0).max(1),
  inatecRate: z.number().min(0).max(1),
  irBrackets: z.array(bracket).min(1),
  irDeductInss: z.boolean(),
  aguinaldoMonthsPerYear: z.number().min(0).max(3),
  aguinaldoPeriodStartMonth: z.number().int().min(1).max(12),
  aguinaldoBase: z.enum(["ultimo_salario", "promedio_12_meses", "mayor_ultimos_6_meses"]),
  vacationDaysPerMonth: z.number().min(0).max(10),
  payrollCurrency: z.string(),
});

/** Nueva versión de reglas (no se editan versiones existentes ya usadas en nóminas). */
export async function createRuleSetVersion(ctx: Ctx, raw: { version: string; effectiveFrom: string; params: LaborRuleParams; sources: string; notes?: string }) {
  requirePerm(ctx, "settings.manage");
  const params = parse(ruleParamsSchema, raw.params);
  const effectiveFrom = parse(zRequiredDate(), raw.effectiveFrom);
  if (!raw.sources?.trim()) throw new AppError("VALIDATION", "Indica las fuentes oficiales de las reglas");
  const [prev] = await ctx.tx.select().from(laborRuleSets).where(and(lte(laborRuleSets.effectiveFrom, effectiveFrom), isNull(laborRuleSets.effectiveTo))).orderBy(desc(laborRuleSets.effectiveFrom)).limit(1);
  if (prev) await ctx.tx.update(laborRuleSets).set({ effectiveTo: addDays(effectiveFrom, -1) }).where(eq(laborRuleSets.id, prev.id));
  const [row] = await ctx.tx.insert(laborRuleSets).values({ version: raw.version, effectiveFrom, params, sources: raw.sources, notes: raw.notes ?? null, validated: false }).returning();
  await audit(ctx, { action: "labor_rules.create", entityType: "labor_rule_set", entityId: row.id, summary: `Nueva versión de reglas laborales ${row.version} vigente desde ${effectiveFrom} (pendiente de validación)` });
  return row;
}

/** Marca un conjunto de reglas como validado contra fuentes oficiales. Acción sensible. */
export async function validateRuleSet(ctx: Ctx, id: string, opts: { confirm?: boolean; note?: string } = {}) {
  requirePerm(ctx, "settings.manage");
  const [r] = await ctx.tx.select().from(laborRuleSets).where(eq(laborRuleSets.id, id));
  if (!r) throw notFound("Reglas laborales");
  if (!opts.confirm) {
    throw new AppError("CONFIRMATION_REQUIRED", `Vas a declarar que las reglas ${r.version} fueron verificadas contra fuentes oficiales (La Gaceta, INSS, DGI, MITRAB). A partir de ahí las nóminas dejarán de ser estimaciones. ¿Confirmas?`);
  }
  const [after] = await ctx.tx.update(laborRuleSets).set({ validated: true, validatedBy: ctx.actor.userId, validatedAt: new Date(), notes: opts.note ? `${r.notes ?? ""}\nValidación: ${opts.note}` : r.notes }).where(eq(laborRuleSets.id, id)).returning();
  await audit(ctx, { action: "labor_rules.validate", entityType: "labor_rule_set", entityId: id, summary: `Reglas laborales ${r.version} validadas`, before: r, after });
  return after;
}

// ───────────────────────── Cálculos ─────────────────────────

/** IR anual según tabla progresiva configurada. */
export function annualIncomeTax(annualTaxable: number, brackets: LaborRuleParams["irBrackets"]): number {
  const b = [...brackets].sort((x, y) => x.from - y.from).find((x) => annualTaxable > x.from && (x.to === null || annualTaxable <= x.to));
  if (!b) return 0;
  return round2(b.base + (annualTaxable - b.from) * b.rate);
}

function salaryOn(history: SalaryRow[], date: string) {
  return [...history].filter((h) => h.effectiveDate <= date).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}

export type PayrollCalc = {
  workedDays: number;
  baseSalary: number;
  grossSalary: number;
  otherEarnings: number;
  inssEmployee: number;
  incomeTax: number;
  otherDeductions: number;
  totalDeductions: number;
  netSalary: number;
  inssEmployer: number;
  inatec: number;
  aguinaldoAccrual: number;
  vacationDays: number;
  vacationAccrual: number;
  currency: string;
  detail: Record<string, unknown>;
};

/**
 * Cálculo quincenal de un colaborador. Salario bruto proporcional a días comerciales trabajados
 * (cada tramo con el salario vigente), deducciones según las reglas configuradas.
 * El IR usa el método de proyección mensual × 12 (estimación administrativa).
 */
export function calculatePayroll(
  emp: Pick<Employee, "startDate" | "terminationDate">,
  history: SalaryRow[],
  period: { periodStart: string; periodEnd: string },
  rules: LaborRuleParams,
  adjustments: { type: string; amount: number; concept: string }[] = [],
): PayrollCalc | null {
  const from = emp.startDate > period.periodStart ? emp.startDate : period.periodStart;
  const to = emp.terminationDate && emp.terminationDate < period.periodEnd ? emp.terminationDate : period.periodEnd;
  if (to < from) return null;
  // Tramos por cambios salariales dentro del período.
  const changes = history.filter((h) => h.effectiveDate > from && h.effectiveDate <= to).map((h) => h.effectiveDate).sort();
  const cuts = [from, ...changes];
  let gross = 0;
  let workedDays = 0;
  const segments: { from: string; to: string; days: number; monthly: number }[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const segFrom = cuts[i];
    const segTo = i + 1 < cuts.length ? addDays(cuts[i + 1], -1) : to;
    const s = salaryOn(history, segFrom);
    if (!s) continue;
    const days = Math.min(commercialDays(segFrom, segTo), 15);
    workedDays += days;
    gross += (s.salary / 30) * days;
    segments.push({ from: segFrom, to: segTo, days, monthly: s.salary });
  }
  workedDays = Math.min(workedDays, 15);
  const current = salaryOn(history, to);
  if (!current) return null;
  const otherEarnings = sum(adjustments.filter((a) => a.type === "percepcion").map((a) => a.amount));
  const otherDeductions = sum(adjustments.filter((a) => a.type === "deduccion").map((a) => a.amount));
  const grossSalary = round2(gross);
  const taxableGross = round2(grossSalary + otherEarnings);
  const inssEmployee = round2(taxableGross * rules.inssEmployeeRate);
  // IR: proyectar el ingreso mensual equivalente, anualizar, aplicar tabla y prorratear a la quincena.
  const monthlyEquivalent = workedDays > 0 ? (taxableGross / workedDays) * 30 : 0;
  const monthlyTaxable = monthlyEquivalent - (rules.irDeductInss ? monthlyEquivalent * rules.inssEmployeeRate : 0);
  const annualTax = annualIncomeTax(monthlyTaxable * 12, rules.irBrackets);
  const incomeTax = round2((annualTax / 12) * (workedDays / 30));
  const totalDeductions = round2(inssEmployee + incomeTax + otherDeductions);
  const netSalary = round2(taxableGross - totalDeductions);
  const inssEmployer = round2(taxableGross * rules.inssEmployerRate);
  const inatec = round2(taxableGross * rules.inatecRate);
  const aguinaldoAccrual = round2((grossSalary * rules.aguinaldoMonthsPerYear) / 12);
  const vacationDays = round2((rules.vacationDaysPerMonth * workedDays) / 30);
  const vacationAccrual = round2((current.salary / 30) * vacationDays);
  return {
    workedDays,
    baseSalary: current.salary,
    grossSalary,
    otherEarnings,
    inssEmployee,
    incomeTax,
    otherDeductions,
    totalDeductions,
    netSalary,
    inssEmployer,
    inatec,
    aguinaldoAccrual,
    vacationDays,
    vacationAccrual,
    currency: current.currency,
    detail: {
      segments,
      adjustments,
      formula: {
        bruto: "salario mensual ÷ 30 × días comerciales trabajados",
        inss: `${rules.inssEmployeeRate * 100}% del bruto`,
        ir: "tabla progresiva anual sobre (ingreso mensual equivalente − INSS) × 12, prorrateada a la quincena",
        patronal: `INSS ${rules.inssEmployerRate * 100}% + INATEC ${rules.inatecRate * 100}%`,
      },
      monthlyTaxable: round2(monthlyTaxable),
      annualTax,
    },
  };
}

// ───────────────────────── Nóminas ─────────────────────────

async function loadAdjustments(ctx: Ctx, periodId: string) {
  return ctx.tx.select().from(payrollAdjustments).where(eq(payrollAdjustments.periodId, periodId));
}

/** Prepara (o recalcula, si está en borrador) la nómina de un período. */
export async function preparePayroll(ctx: Ctx, raw: { periodStart: string; periodEnd: string; payDate?: string; frequency?: "quincenal" | "mensual" }) {
  requirePerm(ctx, "payroll.write");
  const periodStart = parse(zRequiredDate(), raw.periodStart);
  const periodEnd = parse(zRequiredDate(), raw.periodEnd);
  if (periodEnd < periodStart) throw new AppError("VALIDATION", "El fin del período es anterior al inicio");
  const frequency = raw.frequency ?? "quincenal";
  if (frequency !== "quincenal") throw new AppError("VALIDATION", "Por ahora la nómina se calcula de forma quincenal");
  const rules = await getRuleSet(ctx, periodEnd);
  let [period] = await ctx.tx
    .select()
    .from(payrollPeriods)
    .where(and(eq(payrollPeriods.periodStart, periodStart), eq(payrollPeriods.periodEnd, periodEnd), eq(payrollPeriods.frequency, frequency)))
    .for("update");
  if (period && period.status !== "borrador") throw conflict(`La nómina del ${formatDate(periodStart)} al ${formatDate(periodEnd)} ya está ${period.status} y no se recalcula`);
  if (!period) {
    [period] = await ctx.tx
      .insert(payrollPeriods)
      .values({ periodStart, periodEnd, payDate: raw.payDate ?? periodEnd, frequency, ruleSetId: rules.id, isEstimate: !rules.validated, createdBy: ctx.actor.userId })
      .returning();
  } else {
    await ctx.tx.update(payrollPeriods).set({ ruleSetId: rules.id, isEstimate: !rules.validated }).where(eq(payrollPeriods.id, period.id));
    await ctx.tx.delete(payrollRecords).where(eq(payrollRecords.periodId, period.id));
  }
  const emps = await ctx.tx
    .select()
    .from(employees)
    .where(and(eq(employees.payFrequency, frequency), lte(employees.startDate, periodEnd), or(isNull(employees.terminationDate), gte(employees.terminationDate, periodStart))));
  const histories = emps.length ? await ctx.tx.select().from(employeeSalaryHistory).where(inArray(employeeSalaryHistory.employeeId, emps.map((e) => e.id))) : [];
  const adjustments = await loadAdjustments(ctx, period.id);
  const skipped: { name: string; reason: string }[] = [];
  let count = 0;
  for (const e of emps) {
    if (e.status === "suspendido") {
      skipped.push({ name: e.fullName, reason: "Suspendido" });
      continue;
    }
    const hist = histories.filter((h) => h.employeeId === e.id);
    const calc = calculatePayroll(e, hist, { periodStart, periodEnd }, rules.params, adjustments.filter((a) => a.employeeId === e.id));
    if (!calc) {
      skipped.push({ name: e.fullName, reason: "Sin salario registrado para el período" });
      continue;
    }
    if (calc.currency !== rules.params.payrollCurrency) {
      skipped.push({ name: e.fullName, reason: `Salario en ${calc.currency}; la nómina se calcula en ${rules.params.payrollCurrency}` });
      continue;
    }
    await ctx.tx.insert(payrollRecords).values({
      periodId: period.id,
      employeeId: e.id,
      baseSalary: calc.baseSalary,
      grossSalary: calc.grossSalary,
      otherEarnings: calc.otherEarnings,
      inssEmployee: calc.inssEmployee,
      incomeTax: calc.incomeTax,
      otherDeductions: calc.otherDeductions,
      totalDeductions: calc.totalDeductions,
      netSalary: calc.netSalary,
      inssEmployer: calc.inssEmployer,
      inatec: calc.inatec,
      currency: calc.currency,
      workedDays: calc.workedDays,
      detail: { ...calc.detail, aguinaldoAccrual: calc.aguinaldoAccrual, vacationDays: calc.vacationDays, vacationAccrual: calc.vacationAccrual },
    });
    count++;
  }
  await audit(ctx, { action: "payroll.prepare", entityType: "payroll_period", entityId: period.id, summary: `Nómina ${formatDate(periodStart)} – ${formatDate(periodEnd)} preparada: ${count} colaborador(es)${rules.validated ? "" : " (ESTIMACIÓN: reglas sin validar)"}` });
  return { period: (await ctx.tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, period.id)))[0], count, skipped, estimate: !rules.validated };
}

export async function addPayrollAdjustment(ctx: Ctx, periodId: string, raw: { employeeId: string; type: "percepcion" | "deduccion"; concept: string; amount: number }) {
  requirePerm(ctx, "payroll.write");
  const input = parse(z.object({ employeeId: z.uuid(), type: z.enum(["percepcion", "deduccion"]), concept: zRequiredText(200), amount: zPositiveMoney() }), raw);
  const [p] = await ctx.tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
  if (!p) throw notFound("Nómina");
  if (p.status !== "borrador") throw conflict("Solo se agregan ajustes a nóminas en borrador");
  await ctx.tx.insert(payrollAdjustments).values({ periodId, ...input, authorizedBy: ctx.actor.userId });
  await audit(ctx, { action: "payroll.adjustment", entityType: "payroll_period", entityId: periodId, summary: `Ajuste autorizado (${input.type}): ${input.concept} · ${input.amount}` });
  return preparePayroll(ctx, { periodStart: p.periodStart, periodEnd: p.periodEnd, payDate: p.payDate, frequency: p.frequency as "quincenal" });
}

export async function getPayroll(ctx: Ctx, id: string) {
  requirePerm(ctx, "payroll.read");
  const [p] = await ctx.tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
  if (!p) throw notFound("Nómina");
  const records = await ctx.tx
    .select({ r: payrollRecords, name: employees.fullName, position: employees.position })
    .from(payrollRecords)
    .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
    .where(eq(payrollRecords.periodId, id))
    .orderBy(asc(employees.fullName));
  const adjustments = await loadAdjustments(ctx, id);
  const [rules] = p.ruleSetId ? await ctx.tx.select().from(laborRuleSets).where(eq(laborRuleSets.id, p.ruleSetId)) : [];
  const rows = records.map((r) => ({ ...r.r, name: r.name, position: r.position }));
  return {
    ...p,
    rules: rules ?? null,
    records: rows,
    adjustments,
    totals: {
      gross: sum(rows.map((r) => r.grossSalary + r.otherEarnings)),
      inssEmployee: sum(rows.map((r) => r.inssEmployee)),
      incomeTax: sum(rows.map((r) => r.incomeTax)),
      otherDeductions: sum(rows.map((r) => r.otherDeductions)),
      net: sum(rows.map((r) => r.netSalary)),
      inssEmployer: sum(rows.map((r) => r.inssEmployer)),
      inatec: sum(rows.map((r) => r.inatec)),
    },
  };
}

export async function listPayrolls(ctx: Ctx) {
  requirePerm(ctx, "payroll.read");
  const net = sql<number>`(select coalesce(sum(net_salary),0)::float from payroll_records r where r.period_id = ${payrollPeriods.id})`;
  const n = sql<number>`(select count(*)::int from payroll_records r where r.period_id = ${payrollPeriods.id})`;
  return ctx.tx.select({ p: payrollPeriods, net, n }).from(payrollPeriods).orderBy(desc(payrollPeriods.periodStart));
}

/** Aprobar exige reglas validadas: una estimación no puede convertirse en nómina definitiva. */
export async function approvePayroll(ctx: Ctx, id: string, opts: { confirm?: boolean } = {}) {
  requirePerm(ctx, "payroll.approve");
  const [p] = await ctx.tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, id)).for("update");
  if (!p) throw notFound("Nómina");
  if (p.status !== "borrador") throw conflict(`La nómina ya está ${p.status}`);
  const [rules] = await ctx.tx.select().from(laborRuleSets).where(eq(laborRuleSets.id, p.ruleSetId!));
  if (!rules?.validated) {
    throw conflict(`La nómina se calculó con reglas sin validar (${rules?.version ?? "—"}). Es una estimación administrativa: valida las reglas laborales contra fuentes oficiales y recalcula antes de aprobar.`);
  }
  if (p.isEstimate) throw conflict("La nómina se calculó como estimación; recalcúlala con las reglas validadas antes de aprobar");
  const [{ n }] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(payrollRecords).where(eq(payrollRecords.periodId, id));
  if (!n) throw conflict("La nómina no tiene colaboradores");
  if (!opts.confirm) throw new AppError("CONFIRMATION_REQUIRED", `Se aprobará la nómina del ${formatDate(p.periodStart)} al ${formatDate(p.periodEnd)} (${n} colaborador(es)). Después no podrá modificarse. ¿Confirmas?`);
  const [after] = await ctx.tx.update(payrollPeriods).set({ status: "aprobada", approvedBy: ctx.actor.userId, approvedAt: new Date() }).where(eq(payrollPeriods.id, id)).returning();
  await audit(ctx, { action: "payroll.approve", entityType: "payroll_period", entityId: id, summary: `Nómina ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)} aprobada` });
  return after;
}

/**
 * Contabiliza una nómina aprobada (una sola vez): genera los gastos/obligaciones por pagar
 *  · Salarios netos por pagar (a colaboradores)
 *  · Retenciones laborales (INSS laboral + IR) por enterar
 *  · Aportes patronales (INSS patronal + INATEC)
 * y registra las provisiones (aguinaldo, vacaciones), que no son salida de caja.
 */
export async function postPayroll(ctx: Ctx, id: string) {
  requirePerm(ctx, "payroll.approve");
  const [p] = await ctx.tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, id)).for("update");
  if (!p) throw notFound("Nómina");
  if (p.status === "contabilizada" || p.status === "pagada") throw conflict("La nómina ya fue contabilizada");
  if (p.status !== "aprobada") throw conflict("Solo se contabilizan nóminas aprobadas");
  const data = await getPayroll(ctx, id);
  const cats = await ctx.tx.select().from(expenseCategories).where(inArray(expenseCategories.key, ["nomina", "aportes_patronales"]));
  const catId = (k: string) => cats.find((c) => c.key === k)!.id;
  const label = `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`;
  const currency = data.records[0]?.currency ?? "NIO";
  const lines = [
    { key: "neto", name: `Salarios netos por pagar ${label}`, cat: "nomina", amount: data.totals.net, supplier: "Colaboradores", due: p.payDate },
    { key: "retenciones", name: `Retenciones laborales (INSS laboral + IR) ${label}`, cat: "nomina", amount: round2(data.totals.inssEmployee + data.totals.incomeTax), supplier: "INSS / DGI", due: null },
    { key: "patronal", name: `Aportes patronales (INSS + INATEC) ${label}`, cat: "aportes_patronales", amount: round2(data.totals.inssEmployer + data.totals.inatec), supplier: "INSS / INATEC", due: null },
  ].filter((l) => l.amount > 0);
  const created = await ctx.elevate(async () => {
    const out = [];
    for (const l of lines) {
      const [row] = await ctx.tx
        .insert(expenses)
        .values({
          name: l.name,
          categoryId: catId(l.cat),
          supplier: l.supplier,
          amount: l.amount,
          currency,
          registeredAt: ctx.today,
          dueDate: l.due,
          accountingDate: p.periodEnd,
          sourceType: "nomina",
          sourceKey: `payroll:${id}:${l.key}`,
          createdBy: ctx.actor.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (row) out.push(row);
    }
    return out;
  });
  for (const r of data.records) {
    const d = r.detail as { aguinaldoAccrual?: number; vacationDays?: number; vacationAccrual?: number };
    await ctx.tx
      .insert(laborBenefitAccruals)
      .values([
        { employeeId: r.employeeId, periodId: id, benefit: "aguinaldo", amount: d.aguinaldoAccrual ?? 0, currency: r.currency },
        { employeeId: r.employeeId, periodId: id, benefit: "vacaciones", amount: d.vacationAccrual ?? 0, days: d.vacationDays ?? 0, currency: r.currency },
      ])
      .onConflictDoNothing();
  }
  const [after] = await ctx.tx.update(payrollPeriods).set({ status: "contabilizada", postedBy: ctx.actor.userId, postedAt: new Date() }).where(eq(payrollPeriods.id, id)).returning();
  await audit(ctx, { action: "payroll.post", entityType: "payroll_period", entityId: id, summary: `Nómina ${label} contabilizada: ${created.length} obligación(es) generada(s)`, after: created });
  return { period: after, expenses: created };
}

/** Registra el pago de los salarios netos (paga el gasto "Salarios netos por pagar"). Acción irreversible. */
export async function markPayrollPaid(ctx: Ctx, id: string, raw: { paidAt: string; method: "transferencia" | "efectivo" | "cheque" | "deposito" }, opts: { confirm?: boolean } = {}) {
  requirePerm(ctx, "payroll.approve");
  const [p] = await ctx.tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, id)).for("update");
  if (!p) throw notFound("Nómina");
  if (p.status !== "contabilizada") throw conflict("Solo se marca como pagada una nómina contabilizada");
  if (!opts.confirm) throw new AppError("CONFIRMATION_REQUIRED", `Se registrará el pago de los salarios netos de la nómina ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}. ¿Confirmas?`);
  const [net] = await ctx.elevate(() => ctx.tx.select().from(expenses).where(eq(expenses.sourceKey, `payroll:${id}:neto`)));
  if (net && net.status !== "pagado") {
    const { recordExpensePayment } = await import("./expenses");
    await ctx.elevate(() => recordExpensePayment(ctx, net.id, { paidAt: raw.paidAt, method: raw.method, idempotencyKey: `payroll-paid:${id}` }));
  }
  await ctx.tx.update(payrollRecords).set({ payStatus: "pagado", paidAt: raw.paidAt }).where(eq(payrollRecords.periodId, id));
  const [after] = await ctx.tx.update(payrollPeriods).set({ status: "pagada" }).where(eq(payrollPeriods.id, id)).returning();
  await audit(ctx, { action: "payroll.paid", entityType: "payroll_period", entityId: id, summary: `Nómina ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)} pagada el ${formatDate(raw.paidAt)}` });
  return after;
}

/** Recibo de pago de un colaborador en una nómina. */
export async function payslip(ctx: Ctx, periodId: string, employeeId: string) {
  if (ctx.actor.employeeId !== employeeId) requirePerm(ctx, "payroll.read");
  const rows = await ctx.elevate(async () =>
    ctx.tx
      .select({ r: payrollRecords, p: payrollPeriods, name: employees.fullName, position: employees.position })
      .from(payrollRecords)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRecords.periodId))
      .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
      .where(and(eq(payrollRecords.periodId, periodId), eq(payrollRecords.employeeId, employeeId))),
  );
  if (!rows.length) throw notFound("Recibo");
  if (ctx.actor.employeeId === employeeId && !can(ctx, "payroll.read") && rows[0].p.status === "borrador") throw forbidden("El recibo estará disponible cuando la nómina se apruebe");
  return { ...rows[0].r, period: rows[0].p, name: rows[0].name, position: rows[0].position };
}

// ───────────────────────── Aguinaldo y vacaciones ─────────────────────────

/** Estimación del aguinaldo (décimo tercer mes) acumulado a una fecha, con el detalle del cálculo. */
export async function aguinaldoEstimate(ctx: Ctx, employeeId: string, asOf?: string) {
  if (ctx.actor.employeeId !== employeeId) requirePerm(ctx, "payroll.read");
  const date = asOf ?? ctx.today;
  return ctx.elevate(async () => {
    const [emp] = await ctx.tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!emp) throw notFound("Colaborador");
    const rules = await getRuleSet(ctx, date);
    const startMonth = rules.params.aguinaldoPeriodStartMonth;
    const { y, m } = parseISO(date);
    const periodYear = m >= startMonth ? y : y - 1;
    const periodStart = makeISO(periodYear, startMonth, 1);
    const periodEnd = addDays(makeISO(periodYear + 1, startMonth, 1), -1);
    const from = emp.startDate > periodStart ? emp.startDate : periodStart;
    const to = [date, periodEnd, emp.terminationDate].filter(Boolean).sort()[0]!;
    const days = commercialDays(from, to);
    const history = await ctx.tx.select().from(employeeSalaryHistory).where(eq(employeeSalaryHistory.employeeId, employeeId));
    let base = 0;
    let baseDetail = "";
    const sorted = [...history].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const cur = salaryOn(history, to);
    if (rules.params.aguinaldoBase === "ultimo_salario") {
      base = cur?.salary ?? 0;
      baseDetail = "Último salario ordinario vigente";
    } else {
      const monthsBack = rules.params.aguinaldoBase === "promedio_12_meses" ? 12 : 6;
      const samples: number[] = [];
      for (let i = 0; i < monthsBack; i++) {
        const monthEnd = lastOfMonth(addMonths(firstOfMonth(to), -i));
        if (monthEnd < emp.startDate) break;
        const s = salaryOn(sorted, monthEnd > to ? to : monthEnd);
        if (s) samples.push(s.salary);
      }
      base = rules.params.aguinaldoBase === "promedio_12_meses" ? (samples.length ? sum(samples) / samples.length : 0) : Math.max(0, ...samples);
      baseDetail = rules.params.aguinaldoBase === "promedio_12_meses" ? "Promedio de salarios de los últimos 12 meses" : "Salario más alto de los últimos 6 meses";
    }
    const amount = round2((base * rules.params.aguinaldoMonthsPerYear * Math.max(days, 0)) / 360);
    return {
      employee: emp.fullName,
      periodStart,
      periodEnd,
      daysConsidered: Math.max(days, 0),
      base: round2(base),
      baseDetail,
      amount,
      currency: cur?.currency ?? rules.params.payrollCurrency,
      salaryChanges: sorted.map((s) => ({ effectiveDate: s.effectiveDate, salary: s.salary })),
      formula: `${baseDetail} × ${rules.params.aguinaldoMonthsPerYear} mes(es) × días trabajados en el período ÷ 360`,
      rules: { version: rules.version, validated: rules.validated },
      estimate: !rules.validated,
    };
  });
}

/** Saldo de vacaciones: acumulado según reglas − días disfrutados (aprobados) ± ajustes autorizados. */
export async function vacationBalance(ctx: Ctx, employeeId: string, asOf?: string) {
  if (ctx.actor.employeeId !== employeeId) requirePerm(ctx, "leave.read", "payroll.read");
  const date = asOf ?? ctx.today;
  const [emp] = await ctx.tx.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) throw notFound("Colaborador");
  const rules = await getRuleSet(ctx, date);
  const to = emp.terminationDate && emp.terminationDate < date ? emp.terminationDate : date;
  const worked = commercialDays(emp.startDate, to);
  const accrued = round2((rules.params.vacationDaysPerMonth * worked) / 30);
  const requests = await ctx.tx.select().from(vacationRequests).where(eq(vacationRequests.employeeId, employeeId)).orderBy(desc(vacationRequests.startDate));
  const adjustments = await ctx.tx.select().from(leaveAdjustments).where(eq(leaveAdjustments.employeeId, employeeId)).orderBy(desc(leaveAdjustments.createdAt));
  const taken = sum(requests.filter((r) => r.status === "aprobada").map((r) => r.days));
  const pendingRequested = sum(requests.filter((r) => r.status === "solicitada").map((r) => r.days));
  const adjusted = sum(adjustments.map((a) => a.days));
  return {
    employee: emp.fullName,
    workedDays: worked,
    accrued,
    taken,
    adjusted,
    pendingRequested,
    balance: round2(accrued - taken + adjusted),
    requests,
    adjustments,
    rules: { version: rules.version, validated: rules.validated, daysPerMonth: rules.params.vacationDaysPerMonth },
    estimate: !rules.validated,
  };
}

export async function requestVacation(ctx: Ctx, raw: { employeeId: string; startDate: string; endDate: string; days: number; reason?: string }) {
  const input = parse(z.object({ employeeId: z.uuid(), startDate: zRequiredDate(), endDate: zRequiredDate(), days: z.coerce.number().positive().max(60), reason: zText(500) }), raw);
  if (ctx.actor.employeeId !== input.employeeId) requirePerm(ctx, "leave.write");
  if (input.endDate < input.startDate) throw new AppError("VALIDATION", "La fecha final es anterior a la inicial");
  const bal = await vacationBalance(ctx, input.employeeId, input.startDate);
  const [row] = await ctx.tx.insert(vacationRequests).values({ ...input, reason: input.reason ?? null, createdBy: ctx.actor.userId }).returning();
  await audit(ctx, { action: "vacation.request", entityType: "vacation_request", entityId: row.id, summary: `Solicitud de vacaciones: ${bal.employee}, ${input.days} día(s) desde ${formatDate(input.startDate)}${input.days > bal.balance ? " (supera el saldo disponible)" : ""}` });
  await notify(ctx, { type: "admin_obligation", title: `Solicitud de vacaciones: ${bal.employee}`, body: `${input.days} día(s) del ${formatDate(input.startDate)} al ${formatDate(input.endDate)}. Saldo: ${bal.balance}.`, link: `/colaboradores/${input.employeeId}`, dedupeKey: `vacation_request:${row.id}` });
  return { request: row, balance: bal.balance, exceedsBalance: input.days > bal.balance };
}

export async function decideVacation(ctx: Ctx, id: string, decision: "aprobada" | "rechazada") {
  requirePerm(ctx, "leave.approve");
  const [r] = await ctx.tx.select().from(vacationRequests).where(eq(vacationRequests.id, id)).for("update");
  if (!r) throw notFound("Solicitud");
  if (r.status !== "solicitada") throw conflict("La solicitud ya fue resuelta");
  const [after] = await ctx.tx.update(vacationRequests).set({ status: decision, decidedBy: ctx.actor.userId, decidedAt: new Date() }).where(eq(vacationRequests.id, id)).returning();
  await audit(ctx, { action: "vacation.decide", entityType: "vacation_request", entityId: id, summary: `Vacaciones ${decision}: ${r.days} día(s) desde ${formatDate(r.startDate)}` });
  await notify(ctx, { type: "task_assigned", title: `Tu solicitud de vacaciones fue ${decision}`, link: `/colaboradores/${r.employeeId}`, dedupeKey: `vacation_decided:${id}`, employeeIds: [r.employeeId], broadcast: false });
  return after;
}

export async function addLeaveAdjustment(ctx: Ctx, raw: { employeeId: string; days: number; reason: string }) {
  requirePerm(ctx, "leave.approve");
  const input = parse(z.object({ employeeId: z.uuid(), days: z.coerce.number().refine((n) => n !== 0, "No puede ser cero"), reason: zRequiredText(300) }), raw);
  const [row] = await ctx.tx.insert(leaveAdjustments).values({ ...input, authorizedBy: ctx.actor.userId! }).returning();
  await audit(ctx, { action: "vacation.adjust", entityType: "leave_adjustment", entityId: row.id, summary: `Ajuste de vacaciones: ${input.days > 0 ? "+" : ""}${input.days} día(s). ${input.reason}` });
  return row;
}

/** Próximas nóminas a preparar (para avisos y dashboard). */
export async function upcomingPayrolls(ctx: Ctx) {
  const periods = [...fortnightsOf(ctx.today), ...fortnightsOf(addDays(lastOfMonth(ctx.today), 1))];
  const existing = await ctx.elevate(() => ctx.tx.select().from(payrollPeriods).where(gte(payrollPeriods.periodEnd, addDays(ctx.today, -20))));
  return periods
    .filter((p) => p.payDate >= ctx.today)
    .map((p) => ({ ...p, existing: existing.find((e) => e.periodStart === p.periodStart && e.periodEnd === p.periodEnd) ?? null }));
}


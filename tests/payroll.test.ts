import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { as, asSystem, at, makeUser, uniq } from "./helpers";
import { createEmployee } from "@/server/services/employees";
import {
  aguinaldoEstimate,
  annualIncomeTax,
  approvePayroll,
  calculatePayroll,
  commercialDays,
  fortnightsOf,
  getRuleSet,
  markPayrollPaid,
  postPayroll,
  preparePayroll,
  requestVacation,
  decideVacation,
  vacationBalance,
  validateRuleSet,
} from "@/server/services/payroll";
import { expenses, laborRuleSets } from "@/server/db/schema";

describe("Cálculos laborales", () => {
  it("días comerciales y quincenas", () => {
    expect(commercialDays("2026-10-16", "2026-10-31")).toBe(15);
    expect(commercialDays("2026-02-16", "2026-02-28")).toBe(15);
    expect(commercialDays("2026-10-21", "2026-10-31")).toBe(10);
    expect(commercialDays("2025-12-01", "2026-11-30")).toBe(360);
    expect(fortnightsOf("2026-10-01")).toEqual([
      { periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15" },
      { periodStart: "2026-10-16", periodEnd: "2026-10-31", payDate: "2026-10-31" },
    ]);
  });

  it("calcula bruto, deducciones y neto sin confundirlos (parámetros de referencia)", async () => {
    const rules = await asSystem((ctx) => getRuleSet(ctx, "2026-10-31"));
    expect(annualIncomeTax(100440, rules.params.irBrackets)).toBe(66);
    const hist = [{ id: "x", employeeId: "e", salary: 9000, currency: "NIO", effectiveDate: "2026-01-01", reason: null, changedBy: null, createdAt: new Date() }];
    const c = calculatePayroll({ startDate: "2026-01-01", terminationDate: null }, hist, { periodStart: "2026-10-16", periodEnd: "2026-10-31" }, rules.params)!;
    expect(c).toMatchObject({ workedDays: 15, grossSalary: 4500, inssEmployee: 315, incomeTax: 2.75, netSalary: 4182.25, inssEmployer: 967.5, inatec: 90 });
    const partial = calculatePayroll({ startDate: "2026-10-21", terminationDate: null }, hist, { periodStart: "2026-10-16", periodEnd: "2026-10-31" }, rules.params)!;
    expect(partial).toMatchObject({ workedDays: 10, grossSalary: 3000 });
  });
});

describe("Nómina", () => {
  it("una estimación no se aprueba; validada, se aprueba y se contabiliza una sola vez", async () => {
    const manager = await makeUser("gerencia");
    const admin = await makeUser("administracion");
    const emp = await as(admin, (ctx) => createEmployee(ctx, { fullName: uniq("Nómina"), salary: 9000, startDate: "2026-10-21" }), at("2026-10-22"));
    const prep = await as(admin, (ctx) => preparePayroll(ctx, { periodStart: "2026-10-16", periodEnd: "2026-10-31" }), at("2026-10-28"));
    expect(prep.estimate).toBe(true);
    await expect(as(manager, (ctx) => approvePayroll(ctx, prep.period.id, { confirm: true }), at("2026-10-28"))).rejects.toMatchObject({ code: "CONFLICT" });

    const [rs] = await asSystem(({ tx }) => tx.select().from(laborRuleSets).where(eq(laborRuleSets.version, "NI-2026-referencia")));
    await expect(as(manager, (ctx) => validateRuleSet(ctx, rs.id), at("2026-10-28"))).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await as(manager, (ctx) => validateRuleSet(ctx, rs.id, { confirm: true, note: "Prueba" }), at("2026-10-28"));
    try {
      const re = await as(admin, (ctx) => preparePayroll(ctx, { periodStart: "2026-10-16", periodEnd: "2026-10-31" }), at("2026-10-28"));
      expect(re.estimate).toBe(false);
      await expect(as(admin, (ctx) => approvePayroll(ctx, re.period.id, { confirm: true }), at("2026-10-28"))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(as(manager, (ctx) => approvePayroll(ctx, re.period.id), at("2026-10-28"))).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
      await as(manager, (ctx) => approvePayroll(ctx, re.period.id, { confirm: true }), at("2026-10-28"));
      await expect(as(admin, (ctx) => preparePayroll(ctx, { periodStart: "2026-10-16", periodEnd: "2026-10-31" }), at("2026-10-28"))).rejects.toMatchObject({ code: "CONFLICT" });

      const posted = await as(manager, (ctx) => postPayroll(ctx, re.period.id), at("2026-10-31"));
      expect(posted.expenses.map((e) => e.name)).toEqual(expect.arrayContaining([expect.stringContaining("Salarios netos"), expect.stringContaining("Aportes patronales")]));
      await expect(as(manager, (ctx) => postPayroll(ctx, re.period.id), at("2026-10-31"))).rejects.toMatchObject({ code: "CONFLICT" });
      const rows = await as(manager, ({ tx }) => tx.select().from(expenses).where(sql`${expenses.sourceKey} like ${"payroll:" + re.period.id + ":%"}`));
      expect(rows.length).toBe(posted.expenses.length);
      const myRecord = (await as(manager, ({ tx }) => tx.execute(sql`select gross_salary, net_salary from payroll_records where period_id = ${re.period.id} and employee_id = ${emp.id}`))).rows[0] as { gross_salary: string; net_salary: string };
      expect(Number(myRecord.gross_salary)).toBe(3000);
      expect(Number(myRecord.net_salary)).toBeLessThan(3000);
      // La BD rechaza modificar importes de una nómina cerrada
      await expect(as(manager, ({ tx }) => tx.execute(sql`update payroll_records set net_salary = 1 where period_id = ${re.period.id}`))).rejects.toThrow();
      const paid = await as(manager, (ctx) => markPayrollPaid(ctx, re.period.id, { paidAt: "2026-10-31", method: "transferencia" }, { confirm: true }), at("2026-10-31"));
      expect(paid.status).toBe("pagada");
    } finally {
      await asSystem(({ tx }) => tx.update(laborRuleSets).set({ validated: false, validatedAt: null, validatedBy: null }).where(eq(laborRuleSets.id, rs.id)));
    }
  });

  it("aguinaldo y vacaciones con detalle, solicitudes y saldo", async () => {
    const admin = await makeUser("administracion");
    const emp = await as(admin, (ctx) => createEmployee(ctx, { fullName: uniq("Prestaciones"), salary: 9000, startDate: "2026-06-01" }), at("2026-06-01"));
    const ag = await as(admin, (ctx) => aguinaldoEstimate(ctx, emp.id, "2026-11-30"), at("2026-11-30"));
    expect(ag).toMatchObject({ periodStart: "2025-12-01", periodEnd: "2026-11-30", daysConsidered: 180, base: 9000, amount: 4500, estimate: true });
    const bal = await as(admin, (ctx) => vacationBalance(ctx, emp.id, "2026-11-30"), at("2026-11-30"));
    expect(bal.accrued).toBe(15); // 6 meses × 2.5 días
    const req = await as(admin, (ctx) => requestVacation(ctx, { employeeId: emp.id, startDate: "2026-12-01", endDate: "2026-12-05", days: 5 }), at("2026-11-30"));
    const manager = await makeUser("gerencia");
    await as(manager, (ctx) => decideVacation(ctx, req.request.id, "aprobada"), at("2026-11-30"));
    const after = await as(admin, (ctx) => vacationBalance(ctx, emp.id, "2026-11-30"), at("2026-11-30"));
    expect(after).toMatchObject({ taken: 5, balance: 10 });
  });
});

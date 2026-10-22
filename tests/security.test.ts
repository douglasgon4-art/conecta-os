import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { as, asSystem, at, makeUser, standardContract, uniq } from "./helpers";
import { db } from "@/server/db";
import { createClient } from "@/server/services/clients";
import { createEmployee } from "@/server/services/employees";
import { createExpense } from "@/server/services/expenses";
import { createLead } from "@/server/services/leads";
import { preparePayroll } from "@/server/services/payroll";
import { recordInvoicePayment } from "@/server/services/invoices";
import { setRolePermissions } from "@/server/services/users";
import { invoices } from "@/server/db/schema";
import { eq } from "drizzle-orm";

const TODAY = at("2026-10-22");

describe("Matriz de permisos por rol (backend)", () => {
  const cases: [string, string, (ctx: Parameters<Parameters<typeof as>[1]>[0]) => Promise<unknown>, boolean][] = [
    ["ventas", "crear prospecto", (ctx) => createLead(ctx, { tradeName: uniq("L") }), true],
    ["ventas", "registrar gasto", (ctx) => createExpense(ctx, { name: "x", category: "otros", amount: 1 }), false],
    ["disenador", "crear colaborador", (ctx) => createEmployee(ctx, { fullName: uniq("E"), startDate: "2026-10-01" }), false],
    ["community_manager", "preparar nómina", (ctx) => preparePayroll(ctx, { periodStart: "2026-10-01", periodEnd: "2026-10-15" }), false],
    ["contabilidad", "registrar gasto", (ctx) => createExpense(ctx, { name: uniq("G"), category: "otros", amount: 10 }), true],
    ["contabilidad", "crear cliente", (ctx) => createClient(ctx, { client: { tradeName: uniq("C") }, contract: standardContract() }), false],
    ["estrategia", "crear prospecto", (ctx) => createLead(ctx, { tradeName: uniq("L") }), false],
    ["administracion", "crear colaborador", (ctx) => createEmployee(ctx, { fullName: uniq("E"), startDate: "2026-10-01" }), true],
  ];
  for (const [role, label, op, allowed] of cases) {
    it(`${role}: ${label} → ${allowed ? "permitido" : "denegado"}`, async () => {
      const u = await makeUser(role);
      const p = as(u, op, TODAY);
      if (allowed) await expect(p).resolves.toBeDefined();
      else await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }

  it("solo settings.manage cambia permisos de roles", async () => {
    const admin = await makeUser("administracion");
    await expect(as(admin, (ctx) => setRolePermissions(ctx, "00000000-0000-0000-0000-000000000000", []))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Seguridad en la base de datos (RLS y privilegios)", () => {
  it("sin contexto de usuario no se ve ninguna fila", async () => {
    const r = await db.execute(sql`select count(*)::int as n from clients`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });

  it("salarios y nómina invisibles sin permiso aunque se consulten directamente", async () => {
    const admin = await makeUser("administracion");
    await as(admin, (ctx) => createEmployee(ctx, { fullName: uniq("Sal"), salary: 5000, startDate: "2026-01-01" }), TODAY);
    const designer = await makeUser("disenador");
    const sal = await as(designer, ({ tx }) => tx.execute(sql`select count(*)::int as n from employee_salary_history`));
    expect((sal.rows[0] as { n: number }).n).toBe(0);
    const total = await asSystem(({ tx }) => tx.execute(sql`select count(*)::int as n from employee_salary_history`));
    expect((total.rows[0] as { n: number }).n).toBeGreaterThan(0);
    const exp = await as(designer, ({ tx }) => tx.execute(sql`select count(*)::int as n from expenses`));
    expect((exp.rows[0] as { n: number }).n).toBe(0);
  });

  it("el rol de la aplicación no puede borrar facturas, clientes ni auditoría, ni editar la auditoría", async () => {
    await expect(asSystem(({ tx }) => tx.execute(sql`delete from invoices`))).rejects.toThrow();
    await expect(asSystem(({ tx }) => tx.execute(sql`delete from clients`))).rejects.toThrow();
    await expect(asSystem(({ tx }) => tx.execute(sql`update audit_logs set summary = 'x'`))).rejects.toThrow();
    await expect(asSystem(({ tx }) => tx.execute(sql`delete from audit_logs`))).rejects.toThrow();
  });

  it("dos cobros simultáneos no pueden superar el saldo", async () => {
    const acc = await makeUser("contabilidad");
    const admin = await makeUser("administracion");
    const c = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Concurrente") }, contract: standardContract() }), TODAY);
    const [inv] = await as(acc, ({ tx }) => tx.select().from(invoices).where(eq(invoices.clientId, c.client.id)));
    const pay = () => as(acc, (ctx) => recordInvoicePayment(ctx, inv.id, { amount: 8000, paidAt: "2026-10-22", method: "efectivo" }), TODAY);
    const results = await Promise.allSettled([pay(), pay()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [after] = await as(acc, ({ tx }) => tx.select().from(invoices).where(eq(invoices.id, inv.id)));
    expect(after.paidAmount).toBe(8000);
  });
});

import { describe, expect, it } from "vitest";
import { as, at, makeUser, uniq } from "./helpers";
import { changeSalary, createEmployee, getEmployee, listEmployees, updateEmployee } from "@/server/services/employees";

const TODAY = at("2026-10-22");

describe("Colaboradores", () => {
  it("crea un colaborador con salario y fecha de inicio, y conserva el historial salarial", async () => {
    const admin = await makeUser("administracion");
    const name = uniq("Douglas González");
    const emp = await as(admin, (ctx) => createEmployee(ctx, { fullName: name, salary: 9000, currency: "NIO", startDate: "2026-10-21" }), TODAY);
    expect(emp.salary).toBe(9000);
    await as(admin, (ctx) => changeSalary(ctx, emp.id, { salary: 10000, currency: "NIO", effectiveDate: "2026-12-01", reason: "Ajuste" }), TODAY);
    const detail = await as(admin, (ctx) => getEmployee(ctx, emp.id), TODAY);
    expect(detail.salaryHistory!.map((s) => s.salary)).toEqual([10000, 9000]);
    expect(detail.currentSalary!.salary).toBe(9000); // el aumento aún no es efectivo
  });

  it("detecta duplicados por nombre normalizado", async () => {
    const admin = await makeUser("administracion");
    const name = uniq("María López");
    await as(admin, (ctx) => createEmployee(ctx, { fullName: name, startDate: "2026-10-01" }), TODAY);
    await expect(
      as(admin, (ctx) => createEmployee(ctx, { fullName: name.toUpperCase().replace("I", "Í"), startDate: "2026-10-01" }), TODAY),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("los cambios salariales retroactivos exigen confirmación", async () => {
    const admin = await makeUser("administracion");
    const emp = await as(admin, (ctx) => createEmployee(ctx, { fullName: uniq("Retro"), salary: 8000, startDate: "2026-01-01" }), TODAY);
    await expect(as(admin, (ctx) => changeSalary(ctx, emp.id, { salary: 9000, effectiveDate: "2026-09-01" }), TODAY)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const row = await as(admin, (ctx) => changeSalary(ctx, emp.id, { salary: 9000, effectiveDate: "2026-09-01" }, { confirmRetroactive: true }), TODAY);
    expect(row.salary).toBe(9000);
  });

  it("registra cambios de cargo con fecha efectiva y oculta salarios sin permiso", async () => {
    const admin = await makeUser("administracion");
    const emp = await as(admin, (ctx) => createEmployee(ctx, { fullName: uniq("Cargo"), salary: 7000, startDate: "2026-01-01", position: "Diseñador" }), TODAY);
    await as(admin, (ctx) => updateEmployee(ctx, emp.id, { position: "Diseñador senior", effectiveDate: "2026-11-01" }), TODAY);
    const d = await as(admin, (ctx) => getEmployee(ctx, emp.id), TODAY);
    expect(d.changes[0]).toMatchObject({ field: "position", oldValue: "Diseñador", newValue: "Diseñador senior", effectiveDate: "2026-11-01" });

    const strategist = await makeUser("estrategia");
    const list = await as(strategist, (ctx) => listEmployees(ctx, { includeSalary: true }), TODAY);
    expect(list.find((e) => e.id === emp.id)?.salary).toBeNull();
    const cm = await makeUser("community_manager");
    await expect(as(cm, (ctx) => changeSalary(ctx, emp.id, { salary: 1, effectiveDate: "2026-12-01" }), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

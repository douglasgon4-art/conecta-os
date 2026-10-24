import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { as, at, makeUser, uniq } from "./helpers";
import { importRows, parseCSV, templateCSV } from "@/server/services/importer";
import { and, asc } from "drizzle-orm";
import { clientContracts, clients, contentPlanItems, invoices, leaveAdjustments, monthlyContentPlans, productionBoards, productionDeliverables, tasks } from "@/server/db/schema";
import { weekdayDatesInMonth } from "@/lib/dates";

const TODAY = at("2026-10-22");

describe("Importador CSV", () => {
  it("lee CSV con punto y coma, comillas y BOM", () => {
    const rows = parseCSV('﻿Negocio;Teléfono;Notas\n"Clínica ""Sol""";8888-1234;"línea; con punto y coma"\n\n');
    expect(rows).toEqual([{ negocio: 'Clínica "Sol"', telefono: "8888-1234", notas: "línea; con punto y coma" }]);
    expect(parseCSV(templateCSV("colaboradores"))[0].nombre_completo).toBe("Douglas González");
  });

  it("vista previa no guarda; la importación crea clientes activos sin tareas de incorporación y reporta errores por fila", async () => {
    const admin = await makeUser("administracion");
    const name = uniq("Importado");
    const rows: Record<string, string>[] = [
      { nombre_comercial: name, fecha_inicio: "15/01/2026", precio_mensual: "C$ 12,000", moneda: "NIO", redes: "facebook|instagram", estado: "activo" },
      { nombre_comercial: uniq("Sin precio"), fecha_inicio: "2026-01-15" },
      { nombre_comercial: uniq("Fecha mala"), fecha_inicio: "31/02/2026", precio_mensual: "100" },
    ];
    const preview = await as(admin, (ctx) => importRows(ctx, "clientes", rows, { dryRun: true }), TODAY);
    expect(preview).toMatchObject({ total: 3, ok: 1, failed: 2 });
    expect(await as(admin, ({ tx }) => tx.select().from(clients).where(eq(clients.tradeName, name)), TODAY)).toHaveLength(0);

    const real = await as(admin, (ctx) => importRows(ctx, "clientes", rows, { dryRun: false }), TODAY);
    expect(real.ok).toBe(1);
    const [c] = await as(admin, ({ tx }) => tx.select().from(clients).where(eq(clients.tradeName, name)), TODAY);
    expect(c.status).toBe("activo");
    expect(await as(admin, ({ tx }) => tx.select().from(tasks).where(eq(tasks.clientId, c.id)), TODAY)).toHaveLength(0);
    // Reimportar detecta el duplicado
    const again = await as(admin, (ctx) => importRows(ctx, "clientes", rows.slice(0, 1), { dryRun: true }), TODAY);
    expect(again.results[0]).toMatchObject({ ok: false, duplicate: true });
  });

  it("importa colaboradores y prospectos respetando permisos", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => importRows(ctx, "colaboradores", [{ nombre_completo: uniq("Colab"), fecha_inicio: "2026-10-21", salario_mensual: "9,000", moneda: "córdobas" }], { dryRun: false }), TODAY);
    expect(r.ok).toBe(1);
    const sales = await makeUser("ventas");
    await expect(as(sales, (ctx) => importRows(ctx, "colaboradores", [{ nombre_completo: "x", fecha_inicio: "2026-10-01" }], { dryRun: true }), TODAY)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const l = await as(sales, (ctx) => importRows(ctx, "prospectos", [{ negocio: uniq("Prospecto"), ciudad: "León" }], { dryRun: false }), TODAY);
    expect(l.ok).toBe(1);
  });

  it("importa stories, días fijos de publicación, día de pago 30, meses ya pagados y vacaciones pagadas", async () => {
    const boss = await makeUser("gerencia");
    const name = uniq("Clínica Dental");
    const r = await as(boss, (ctx) => importRows(ctx, "clientes", [{
      nombre_comercial: name, fecha_inicio: "28/07/2026", precio_mensual: "200", moneda: "USD", dia_pago: "30",
      artes_mes: "6", reels_mes: "6", stories_mes: "12", dias_publicacion: "lunes|miércoles|viernes", dias_stories: "martes|jueves|sábado",
      foto_perfil: "no", portada: "no", redes: "facebook|instagram|tiktok", pagado_hasta: "2026-10",
    }], { dryRun: false }), TODAY);
    expect(r.results[0]).toMatchObject({ ok: true });
    const [c] = await as(boss, ({ tx }) => tx.select().from(clients).where(eq(clients.tradeName, name)), TODAY);
    const [k] = await as(boss, ({ tx }) => tx.select().from(clientContracts).where(eq(clientContracts.clientId, c.id)), TODAY);
    expect(k).toMatchObject({ billingDay: 30, storiesPerMonth: 12, postWeekdays: [1, 3, 5], storyWeekdays: [2, 4, 6], includeProfilePhoto: false });

    const [board] = await as(boss, ({ tx }) => tx.select().from(productionBoards).where(and(eq(productionBoards.clientId, c.id), eq(productionBoards.period, "2026-11-01"))), TODAY);
    const items = await as(boss, ({ tx }) => tx.select().from(productionDeliverables).where(eq(productionDeliverables.boardId, board.id)), TODAY);
    expect(items).toHaveLength(24);
    expect(items.filter((d) => d.kind === "story")).toHaveLength(12);

    const [plan] = await as(boss, ({ tx }) => tx.select().from(monthlyContentPlans).where(and(eq(monthlyContentPlans.clientId, c.id), eq(monthlyContentPlans.period, "2026-11-01"))), TODAY);
    const planItems = await as(boss, ({ tx }) => tx.select().from(contentPlanItems).where(eq(contentPlanItems.planId, plan.id)).orderBy(asc(contentPlanItems.tentativePublishDate)), TODAY);
    const postDays = weekdayDatesInMonth("2026-11-01", [1, 3, 5]);
    expect(postDays.slice(0, 3)).toEqual(["2026-11-02", "2026-11-04", "2026-11-06"]);
    expect(planItems.map((i) => [i.kind, i.position, i.tentativePublishDate]).slice(0, 3)).toEqual([["diseno", 1, "2026-11-02"], ["reel", 1, "2026-11-04"], ["diseno", 2, "2026-11-06"]]);

    const invs = await as(boss, ({ tx }) => tx.select().from(invoices).where(eq(invoices.clientId, c.id)), TODAY);
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ period: "2026-10-01", dueDate: "2026-10-30", status: "pagada", currency: "USD", amount: 200 });

    const emp = await as(boss, (ctx) => importRows(ctx, "colaboradores", [{ nombre_completo: uniq("Diseñadora"), fecha_inicio: "10/08/2025", salario_mensual: "9000", vacaciones_pagadas_hasta: "31/12/2025" }], { dryRun: false }), TODAY);
    expect(emp.results[0]).toMatchObject({ ok: true });
    const adj = await as(boss, ({ tx }) => tx.select().from(leaveAdjustments).orderBy(asc(leaveAdjustments.createdAt)), TODAY);
    expect(adj.at(-1)?.days).toBe(-11.75); // 141 días comerciales × 2.5 / 30
  });
});

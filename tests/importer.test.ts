import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { as, at, makeUser, uniq } from "./helpers";
import { importRows, parseCSV, templateCSV } from "@/server/services/importer";
import { clients, tasks } from "@/server/db/schema";

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
});

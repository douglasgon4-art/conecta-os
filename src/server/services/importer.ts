import { requirePerm, type Ctx } from "../ctx";
import { AppError, translateDbError } from "../errors";
import { createClient } from "./clients";
import { createEmployee } from "./employees";
import { createLead } from "./leads";
import { isValidISODate } from "@/lib/dates";
import { CLIENT_STATUSES, LEAD_STATUSES, SOCIAL_NETWORKS } from "@/lib/domain";
import type { Permission } from "../auth/permissions";

export type ImportKind = "clientes" | "colaboradores" | "prospectos";

export const IMPORT_TEMPLATES: Record<ImportKind, { label: string; perm: Permission; columns: string[]; example: string[]; required: string[] }> = {
  clientes: {
    label: "Clientes (con su contrato)",
    perm: "clients.write",
    columns: ["nombre_comercial", "razon_social", "ruc", "contacto", "telefono", "correo", "ciudad", "direccion", "sitio_web", "facebook", "instagram", "tiktok", "estado", "fecha_inicio", "precio_mensual", "moneda", "dia_pago", "artes_mes", "reels_mes", "foto_perfil", "portada", "sesion_mensual", "estrategia", "gestion_redes", "redes", "proxima_sesion", "notas"],
    example: ["Consultorio Pepitos", "", "", "Ana Pérez", "8888-0000", "", "Estelí", "", "", "https://facebook.com/pepitos", "", "", "activo", "2026-01-15", "12000", "NIO", "5", "6", "6", "si", "si", "si", "si", "si", "facebook|instagram", "2026-11-12", ""],
    required: ["nombre_comercial", "fecha_inicio", "precio_mensual"],
  },
  colaboradores: {
    label: "Colaboradores",
    perm: "employees.write",
    columns: ["nombre_completo", "telefono", "correo", "cargo", "departamento", "fecha_inicio", "salario_mensual", "moneda", "frecuencia_pago", "tipo_contrato", "jornada", "notas"],
    example: ["Douglas González", "8888-1111", "", "Editor de video", "video", "2026-10-21", "9000", "NIO", "quincenal", "indeterminado", "Lunes a viernes", ""],
    required: ["nombre_completo", "fecha_inicio"],
  },
  prospectos: {
    label: "Prospectos",
    perm: "leads.write",
    columns: ["negocio", "contacto", "telefono", "correo", "ciudad", "tipo_negocio", "fuente", "estado", "proximo_seguimiento", "proxima_accion", "notas"],
    example: ["Clínica Ejemplo", "", "8888-2222", "", "Estelí", "Clínica", "Referido", "pendiente_contactar", "", "", ""],
    required: ["negocio"],
  },
};

/** CSV con coma o punto y coma (Excel en español), comillas dobles y BOM. */
export function parseCSV(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export function templateCSV(kind: ImportKind) {
  const t = IMPORT_TEMPLATES[kind];
  const esc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [t.columns.join(","), t.example.map(esc).join(",")].join("\n") + "\n";
}

/** Acepta AAAA-MM-DD o DD/MM/AAAA. */
function toDate(v: string | undefined) {
  if (!v) return undefined;
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : v;
  if (!isValidISODate(iso)) throw new AppError("VALIDATION", `Fecha inválida: "${v}" (usa AAAA-MM-DD o DD/MM/AAAA)`);
  return iso;
}
const yes = (v: string | undefined, def: boolean) => (!v ? def : ["si", "sí", "s", "1", "true", "x", "yes"].includes(v.toLowerCase()));
const num = (v: string | undefined) => (v ? v.replace(/[^\d.-]/g, "") : undefined);
const blank = (v: string | undefined) => (v ? v : undefined);
const currency = (v: string | undefined) => {
  const c = (v ?? "NIO").toUpperCase();
  return c.startsWith("US") || c === "$" ? "USD" : "NIO";
};

async function importRow(ctx: Ctx, kind: ImportKind, r: Record<string, string>, allowDuplicate: boolean) {
  if (kind === "colaboradores") {
    const e = await createEmployee(
      ctx,
      {
        fullName: r.nombre_completo, phone: blank(r.telefono), email: blank(r.correo), position: blank(r.cargo),
        departmentKey: blank(r.departamento?.toLowerCase()), startDate: toDate(r.fecha_inicio), salary: num(r.salario_mensual),
        currency: currency(r.moneda), payFrequency: blank(r.frecuencia_pago?.toLowerCase()), contractType: blank(r.tipo_contrato?.toLowerCase()),
        workSchedule: blank(r.jornada), notes: blank(r.notas),
      },
      { allowDuplicate },
    );
    return `Colaborador: ${e.fullName}`;
  }
  if (kind === "prospectos") {
    const status = blank(r.estado?.toLowerCase());
    if (status && !LEAD_STATUSES.some((s) => s.value === status)) throw new AppError("VALIDATION", `Estado desconocido: ${status}`);
    if (status === "venta_ganada") throw new AppError("VALIDATION", "Las ventas ganadas se importan como clientes");
    const l = await createLead(
      ctx,
      { tradeName: r.negocio, contactName: blank(r.contacto), phone: blank(r.telefono), email: blank(r.correo), city: blank(r.ciudad), businessType: blank(r.tipo_negocio), source: blank(r.fuente), status, nextFollowupAt: toDate(r.proximo_seguimiento), nextAction: blank(r.proxima_accion), notes: blank(r.notas) },
      { allowDuplicate },
    );
    return `Prospecto: ${l.tradeName}`;
  }
  const status = (r.estado?.toLowerCase() || "activo") as "activo" | "en_incorporacion" | "en_pausa";
  if (!["activo", "en_incorporacion", "en_pausa"].includes(status)) {
    throw new AppError("VALIDATION", `Estado inicial no permitido: ${r.estado} (usa ${CLIENT_STATUSES.filter((s) => ["activo", "en_incorporacion", "en_pausa"].includes(s.value)).map((s) => s.value).join(", ")})`);
  }
  const networks = (r.redes || "facebook|instagram").split(/[|/ ]+/).map((n) => n.trim().toLowerCase()).filter(Boolean);
  const bad = networks.filter((n) => !SOCIAL_NETWORKS.some((s) => s.value === n));
  if (bad.length) throw new AppError("VALIDATION", `Red social desconocida: ${bad.join(", ")}`);
  const res = await createClient(
    ctx,
    {
      client: {
        tradeName: r.nombre_comercial, legalName: blank(r.razon_social), taxId: blank(r.ruc), contactName: blank(r.contacto), phone: blank(r.telefono),
        email: blank(r.correo), city: blank(r.ciudad), address: blank(r.direccion), website: blank(r.sitio_web), notes: blank(r.notas),
        socialLinks: Object.fromEntries((["facebook", "instagram", "tiktok"] as const).filter((k) => r[k]).map((k) => [k, r[k]])),
      },
      contract: {
        startDate: toDate(r.fecha_inicio), monthlyPrice: num(r.precio_mensual), currency: currency(r.moneda), billingDay: num(r.dia_pago) || undefined,
        designsPerMonth: num(r.artes_mes) ?? undefined, reelsPerMonth: num(r.reels_mes) ?? undefined,
        includeProfilePhoto: yes(r.foto_perfil, true), includeCover: yes(r.portada, true), sessionsEnabled: yes(r.sesion_mensual, true),
        includeStrategy: yes(r.estrategia, true), includeCommunity: yes(r.gestion_redes, true), socialNetworks: networks, firstSessionDate: toDate(r.proxima_sesion),
      },
      status: status === "en_pausa" ? "activo" : status,
      onboarding: status === "en_incorporacion",
    },
    { allowDuplicate },
  );
  if (status === "en_pausa") {
    const { setClientStatus } = await import("./clients");
    await setClientStatus(ctx, res.client.id, "en_pausa", "Importado en pausa");
  }
  return `Cliente: ${res.client.tradeName} (${res.workspace.boards} tablero(s), ${res.workspace.invoices} factura(s))`;
}

class DryRun extends Error {}

export type ImportResult = { row: number; ok: boolean; message: string; duplicate?: boolean };

/**
 * Importa filas usando los servicios reales (validación, duplicados, permisos, auditoría).
 * Cada fila va en su propio punto de guardado: una fila con error no afecta a las demás.
 * En vista previa todo se deshace, pero se valida exactamente igual.
 */
export async function importRows(ctx: Ctx, kind: ImportKind, rows: Record<string, string>[], opts: { dryRun: boolean; allowDuplicate?: boolean }) {
  const t = IMPORT_TEMPLATES[kind];
  if (!t) throw new AppError("VALIDATION", "Tipo de importación desconocido");
  requirePerm(ctx, t.perm);
  if (rows.length > 500) throw new AppError("VALIDATION", "Máximo 500 filas por archivo");
  const results: ImportResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const missing = t.required.filter((c) => !r[c]);
    if (missing.length) {
      results.push({ row: i + 2, ok: false, message: `Faltan columnas obligatorias: ${missing.join(", ")}` });
      continue;
    }
    let message = "";
    try {
      await ctx.tx.transaction(async (sp) => {
        message = await importRow(Object.create(ctx, { tx: { value: sp } }) as Ctx, kind, r, !!opts.allowDuplicate);
        if (opts.dryRun) throw new DryRun();
      });
      results.push({ row: i + 2, ok: true, message });
    } catch (e) {
      if (e instanceof DryRun) results.push({ row: i + 2, ok: true, message: `${message} (vista previa)` });
      else {
        const err = e instanceof AppError ? e : translateDbError(e);
        if (!err) throw e;
        results.push({ row: i + 2, ok: false, message: err.message, duplicate: err.code === "DUPLICATE" });
      }
    }
  }
  return { total: rows.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

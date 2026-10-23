"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "@/server/auth/session";
import { withCtx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { importRows, parseCSV, type ImportKind, type ImportResult } from "@/server/services/importer";

export type ImportState = { ok: boolean; error?: string; dryRun?: boolean; total?: number; okCount?: number; failed?: number; results?: ImportResult[] } | null;

export async function importAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Sesión expirada" };
  const file = fd.get("file") as File | null;
  if (!file || !file.size) return { ok: false, error: "Selecciona un archivo CSV" };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: "El archivo supera 2 MB" };
  const kind = String(fd.get("kind")) as ImportKind;
  const dryRun = fd.get("mode") !== "importar";
  const rows = parseCSV(await file.text());
  if (!rows.length) return { ok: false, error: "El archivo no tiene filas de datos" };
  try {
    const r = await withCtx(actor, (ctx) => importRows(ctx, kind, rows, { dryRun, allowDuplicate: fd.get("allowDuplicate") === "on" }));
    if (!dryRun) revalidatePath("/", "layout");
    return { ok: true, dryRun, total: r.total, okCount: r.ok, failed: r.failed, results: r.results };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Error inesperado; no se importó nada" };
  }
}

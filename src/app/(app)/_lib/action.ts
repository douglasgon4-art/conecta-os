import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withCtx, type Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { getActor } from "@/server/auth/session";

export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  /** Mensaje de confirmación requerido: el formulario se reenvía con __confirm=1. */
  confirm?: string;
  details?: unknown;
  at?: number;
} | null;

/** FormData → objeto. Claves repetidas → arreglo; "a.b" → objeto anidado; claves "__" se ignoran salvo __confirm. */
export function formToObject(fd: FormData) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const value = typeof v === "string" ? v : v;
    const parts = k.endsWith("[]") ? [k.slice(0, -2)] : k.split(".");
    let target = out;
    for (let i = 0; i < parts.length - 1; i++) target = (target[parts[i]] ??= {}) as Record<string, unknown>;
    const key = parts.at(-1)!;
    if (k.endsWith("[]")) ((target[key] ??= []) as unknown[]).push(value);
    else if (key in target) target[key] = [...([] as unknown[]).concat(target[key]), value];
    else target[key] = value;
  }
  return out;
}

/**
 * Ejecuta una operación de servicio para un formulario: autentica, abre el contexto (RLS),
 * traduce errores a mensajes, revalida rutas y redirige si corresponde.
 */
export async function run<T>(
  fn: (ctx: Ctx) => Promise<T>,
  opts: { revalidate?: string[]; success?: string | ((r: T) => string); redirectTo?: (r: T) => string | null; duplicateConfirm?: boolean } = {},
): Promise<ActionState> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Tu sesión expiró. Vuelve a iniciar sesión.", code: "UNAUTHENTICATED", at: Date.now() };
  let result: T;
  try {
    result = await withCtx(actor, fn);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "CONFIRMATION_REQUIRED") return { ok: false, confirm: e.message, details: e.details, at: Date.now() };
      if (e.code === "DUPLICATE" && opts.duplicateConfirm && (e.details?.candidates || e.details?.clientCandidates)) {
        return { ok: false, confirm: `${e.message}. ¿Es un registro distinto y quieres crearlo de todas formas?`, details: e.details, at: Date.now() };
      }
      return { ok: false, error: e.message, code: e.code, fieldErrors: (e.details?.fieldErrors as Record<string, string>) ?? undefined, details: e.details, at: Date.now() };
    }
    console.error(e);
    return { ok: false, error: "Ocurrió un error inesperado. No se guardaron cambios.", at: Date.now() };
  }
  for (const p of opts.revalidate ?? ["/"]) revalidatePath(p, "layout");
  const target = opts.redirectTo?.(result);
  if (target) redirect(target);
  return { ok: true, message: typeof opts.success === "function" ? opts.success(result) : (opts.success ?? "Guardado"), at: Date.now() };
}

export const isConfirmed = (o: Record<string, unknown>) => o.__confirm === "1";

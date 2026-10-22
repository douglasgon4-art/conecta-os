import { z } from "zod";
import { invalid } from "./errors";
import { isValidISODate } from "@/lib/dates";
import { CURRENCIES, values } from "@/lib/domain";

z.config(z.locales.es());

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join(".") || "_";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    const first = Object.entries(fieldErrors)[0];
    throw invalid(first ? `${first[0] === "_" ? "" : first[0] + ": "}${first[1]}` : "Datos inválidos", { fieldErrors });
  }
  return r.data;
}

/** Cadena vacía → undefined, para formularios HTML. */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const zText = (max = 500) => z.preprocess(blank, z.string().trim().max(max).optional());
export const zRequiredText = (max = 200) => z.string().trim().min(1, "Requerido").max(max);
export const zDate = () =>
  z.preprocess(blank, z.string().refine(isValidISODate, "Fecha inválida (AAAA-MM-DD)").optional());
export const zRequiredDate = () => z.string().refine(isValidISODate, "Fecha inválida (AAAA-MM-DD)");
export const zUuid = () => z.preprocess(blank, z.uuid().optional());
export const zMoney = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
    z.number().finite().min(0).max(1_000_000_000),
  );
export const zPositiveMoney = () =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
    z.number().finite().positive("Debe ser mayor que cero").max(1_000_000_000),
  );
export const zInt = (min = 0, max = 1000) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v), z.number().int().min(min).max(max));
export const zBool = () =>
  z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());
export const zCurrency = () => z.enum(values(CURRENCIES)).default("NIO");
export const zEmail = () => z.preprocess(blank, z.email("Correo inválido").optional());
export const zTime = () => z.preprocess(blank, z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Hora inválida").optional());

/** Entrada sin tipar estrictamente (formularios, agente): la validación real la hace Zod en el servidor. */
export type Loose<S extends z.ZodType> = { [K in keyof z.infer<S>]?: unknown };

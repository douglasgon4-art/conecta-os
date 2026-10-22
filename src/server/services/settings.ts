import { eq } from "drizzle-orm";
import { z } from "zod";
import { appSettings } from "../db/schema";
import { audit, requirePerm, type Ctx } from "../ctx";
import { invalid } from "../errors";

export type OnboardingTaskTemplate = {
  key: string;
  title: string;
  department: string;
  dueInDays: number;
  /** Solo se crea si el contrato incluye este servicio. */
  requires?: "sessions" | "strategy" | "community" | "design" | "video";
};

export const SETTINGS_SCHEMA = {
  agency_name: z.string().min(1),
  exchange_rate_usd_nio: z.number().positive(),
  base_currency: z.enum(["NIO", "USD"]),
  session_coordination_notice_days: z.number().int().min(0).max(60),
  session_urgent_days: z.number().int().min(0).max(30),
  default_coordination_lead_days: z.number().int().min(0).max(60),
  production_due_day: z.number().int().min(1).max(28),
  strategy_due_days_before: z.number().int().min(0).max(45),
  cycle_lookahead_months: z.number().int().min(0).max(3),
  invoice_issue_days_before: z.number().int().min(0).max(31),
  invoice_due_notice_days: z.number().int().min(0).max(31),
  expense_due_notice_days: z.number().int().min(0).max(31),
  payroll_prepare_days: z.number().int().min(0).max(15),
  /** Regla para asignar gastos generales a clientes en la rentabilidad. */
  overhead_allocation: z.enum(["ninguna", "proporcional_ingresos"]),
  onboarding_tasks: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      department: z.string(),
      dueInDays: z.number().int(),
      requires: z.enum(["sessions", "strategy", "community", "design", "video"]).optional(),
    }),
  ),
};

export type Settings = { [K in keyof typeof SETTINGS_SCHEMA]: z.infer<(typeof SETTINGS_SCHEMA)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  agency_name: "CONECTA",
  // Valor de referencia editable: actualizar con la tasa oficial del Banco Central de Nicaragua.
  exchange_rate_usd_nio: 36.6243,
  base_currency: "NIO",
  session_coordination_notice_days: 10,
  session_urgent_days: 3,
  default_coordination_lead_days: 10,
  production_due_day: 25,
  strategy_due_days_before: 10,
  cycle_lookahead_months: 1,
  invoice_issue_days_before: 5,
  invoice_due_notice_days: 5,
  expense_due_notice_days: 5,
  payroll_prepare_days: 3,
  overhead_allocation: "ninguna",
  onboarding_tasks: [
    { key: "contrato", title: "Firmar y archivar el contrato", department: "administracion", dueInDays: 3 },
    { key: "accesos", title: "Solicitar accesos a las redes sociales", department: "community", dueInDays: 3, requires: "community" },
    { key: "brief", title: "Reunión de brief y levantamiento de marca", department: "estrategia", dueInDays: 5, requires: "strategy" },
    { key: "manual_marca", title: "Recopilar logo, manual de marca y recursos", department: "diseno", dueInDays: 5, requires: "design" },
    { key: "primera_sesion", title: "Coordinar la primera sesión de contenido", department: "produccion", dueInDays: 7, requires: "sessions" },
    { key: "primera_factura", title: "Enviar la primera factura al cliente", department: "contabilidad", dueInDays: 2 },
  ],
};

export async function getSettings(ctx: Ctx): Promise<Settings> {
  const rows = await ctx.tx.select().from(appSettings);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const schema = SETTINGS_SCHEMA[r.key as keyof Settings];
    if (schema && schema.safeParse(r.value).success) merged[r.key] = r.value;
  }
  return merged as Settings;
}

export async function updateSetting<K extends keyof Settings>(ctx: Ctx, key: K, value: unknown) {
  requirePerm(ctx, "settings.manage");
  const schema = SETTINGS_SCHEMA[key];
  if (!schema) throw invalid(`Ajuste desconocido: ${String(key)}`);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid(`Valor inválido para ${String(key)}`);
  const [before] = await ctx.tx.select().from(appSettings).where(eq(appSettings.key, key));
  await ctx.tx
    .insert(appSettings)
    .values({ key, value: parsed.data as never, updatedBy: ctx.actor.userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed.data as never, updatedBy: ctx.actor.userId } });
  await audit(ctx, {
    action: "settings.update",
    entityType: "app_setting",
    summary: `Ajuste "${String(key)}" actualizado`,
    before: before?.value ?? null,
    after: parsed.data,
  });
}

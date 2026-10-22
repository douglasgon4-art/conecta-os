import { load } from "../_lib/page";
import { getSettings } from "@/server/services/settings";
import { Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ConfigTabs } from "./nav";
import { settingsAction } from "./actions";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const d = await load(["settings.manage"], async (ctx) => ({ s: await getSettings(ctx) }));
  const s = d.s;
  const num = (k: keyof typeof s, label: string, hint?: string) => <Field label={label} hint={hint}><Input name={k} defaultValue={String(s[k])} inputMode="decimal" /></Field>;
  return (
    <>
      <PageHeader title="Configuración" />
      <ConfigTabs active="general" />
      <ActionForm action={settingsAction}>
        <Card title="General y finanzas">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nombre de la agencia"><Input name="agency_name" defaultValue={s.agency_name} /></Field>
            {num("exchange_rate_usd_nio", "Tipo de cambio USD → NIO", "Actualízalo con la tasa oficial del BCN")}
            <Field label="Moneda base de informes"><Select name="base_currency" defaultValue={s.base_currency}><option value="NIO">NIO</option><option value="USD">USD</option></Select></Field>
            <Field label="Gastos generales en rentabilidad"><Select name="overhead_allocation" defaultValue={s.overhead_allocation}><option value="ninguna">No asignar a clientes</option><option value="proporcional_ingresos">Proporcional a ingresos</option></Select></Field>
            {num("invoice_issue_days_before", "Emitir factura (días antes del vencimiento)")}
            {num("invoice_due_notice_days", "Avisar facturas por vencer (días)")}
            {num("expense_due_notice_days", "Avisar gastos por vencer (días)")}
            {num("payroll_prepare_days", "Avisar nómina a preparar (días antes del pago)")}
          </div>
        </Card>
        <Card title="Operación">
          <div className="grid gap-3 sm:grid-cols-3">
            {num("session_coordination_notice_days", "Aviso antes de comenzar a coordinar (días)")}
            {num("session_urgent_days", "Días críticos sin confirmar la sesión")}
            {num("default_coordination_lead_days", "Anticipación de coordinación por defecto (días)")}
            {num("production_due_day", "Día límite de producción del mes")}
            {num("strategy_due_days_before", "Planificación lista (días antes del mes)")}
            {num("cycle_lookahead_months", "Meses de anticipación de ciclos")}
          </div>
        </Card>
        <Card title="Tareas de incorporación de nuevos clientes">
          <Field label="Plantilla (JSON)" hint='Cada tarea: {"key","title","department","dueInDays","requires"?: sessions|strategy|community|design|video}'><Textarea name="onboarding_tasks" rows={10} className="font-mono text-xs" defaultValue={JSON.stringify(s.onboarding_tasks, null, 2)} /></Field>
        </Card>
        <SubmitButton>Guardar ajustes</SubmitButton>
      </ActionForm>
    </>
  );
}

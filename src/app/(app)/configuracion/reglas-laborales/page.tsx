import { load } from "../../_lib/page";
import { listRuleSets } from "@/server/services/payroll";
import { can } from "@/server/ctx";
import { Badge, Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { formatDate, formatDateTime } from "@/lib/dates";
import { ConfigTabs } from "../nav";
import { ruleVersionAction, validateRulesAction } from "../actions";

export const metadata = { title: "Reglas laborales" };

export default async function LaborRulesPage() {
  const d = await load(["payroll.read", "settings.manage"], async (ctx) => ({ rows: await listRuleSets(ctx), manage: can(ctx, "settings.manage") }));
  return (
    <>
      <PageHeader title="Reglas laborales y tributarias (Nicaragua)" subtitle="Versionadas por fecha de vigencia. No se codifican como valores permanentes." />
      <ConfigTabs active="reglas" />
      <div className="space-y-4">
        {d.rows.map((r) => (
          <Card key={r.id} title={<span className="flex items-center gap-2">{r.version} {r.validated ? <Badge tone="green">Validada {formatDateTime(r.validatedAt)}</Badge> : <Badge tone="yellow">Pendiente de validación</Badge>}</span>}>
            <p className="text-sm">Vigente desde {formatDate(r.effectiveFrom)}{r.effectiveTo ? ` hasta ${formatDate(r.effectiveTo)}` : ""}</p>
            <div className="mt-2 grid gap-4 lg:grid-cols-2">
              <pre className="overflow-x-auto rounded-md bg-slate-50 p-2 text-xs">{JSON.stringify(r.params, null, 2)}</pre>
              <div className="space-y-2 text-sm">
                <div><strong>Fuentes:</strong><div className="whitespace-pre-wrap text-slate-600">{r.sources}</div></div>
                {r.notes && <div className="rounded-md bg-amber-50 p-2 text-amber-900">{r.notes}</div>}
                {d.manage && !r.validated && (
                  <ActionForm action={validateRulesAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <Field label="Nota de validación (fuente oficial consultada)"><Input name="note" required /></Field>
                    <SubmitButton size="sm">Marcar como validada</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
          </Card>
        ))}
        {d.manage && (
          <Card title="Nueva versión de reglas">
            <ActionForm action={ruleVersionAction}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Versión"><Input name="version" required placeholder="NI-2027-01" /></Field>
                <Field label="Vigente desde"><Input type="date" name="effectiveFrom" required /></Field>
              </div>
              <Field label="Parámetros (JSON)"><Textarea name="params" rows={10} className="font-mono text-xs" required defaultValue={d.rows[0] ? JSON.stringify(d.rows[0].params, null, 2) : ""} /></Field>
              <Field label="Fuentes oficiales"><Textarea name="sources" rows={3} required /></Field>
              <Field label="Notas"><Input name="notes" /></Field>
              <SubmitButton size="sm">Crear versión</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

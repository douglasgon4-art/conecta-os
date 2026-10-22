import { load } from "../../_lib/page";
import { can } from "@/server/ctx";
import { JOBS, listAutomationRuns } from "@/server/automations";
import { Badge, Card, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { formatDateTime } from "@/lib/dates";
import { ConfigTabs } from "../nav";
import { runAutomationsAction } from "../actions";

export const metadata = { title: "Automatizaciones" };

export default async function AutomationsPage() {
  const d = await load(["automations.run", "settings.manage", "audit.read"], async (ctx) => ({ runs: await listAutomationRuns(150), canRun: can(ctx, "automations.run") }));
  return (
    <>
      <PageHeader title="Automatizaciones" subtitle="Se ejecutan a diario por cron en el servidor (no dependen de que alguien abra una pantalla). Cada ejecución queda registrada y puede reintentarse con seguridad." />
      <ConfigTabs active="automatizaciones" />
      <Card title="Trabajos programados" className="mb-4">
        <ul className="grid gap-1 text-sm md:grid-cols-2">{JOBS.map((j) => <li key={j.key}><code className="text-xs">{j.key}</code> — {j.name}</li>)}</ul>
        {d.canRun && (
          <ActionForm action={runAutomationsAction} inline className="mt-3">
            <Select name="job" className="w-72"><option value="">Todas</option>{JOBS.map((j) => <option key={j.key} value={j.key}>{j.name}</option>)}</Select>
            <SubmitButton size="sm">Ejecutar ahora</SubmitButton>
          </ActionForm>
        )}
      </Card>
      <Card title="Historial de ejecuciones" padded={false}>
        <Table>
          <thead><tr><Th>Trabajo</Th><Th>Clave</Th><Th>Inicio</Th><Th>Fin</Th><Th>Intentos</Th><Th>Origen</Th><Th>Resultado</Th></tr></thead>
          <tbody>{d.runs.map((r) => (
            <tr key={r.id}><Td>{r.jobKey}</Td><Td className="text-xs">{r.runKey}</Td><Td className="text-xs">{formatDateTime(r.startedAt)}</Td><Td className="text-xs">{formatDateTime(r.finishedAt)}</Td><Td>{r.attempts}</Td><Td className="text-xs">{r.triggeredBy}</Td>
              <Td><Badge tone={r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "blue"}>{r.status === "succeeded" ? "Correcta" : r.status === "failed" ? "Falló" : "En curso"}</Badge>{r.error && <div className="text-xs text-red-700">{r.error}</div>}<div className="text-xs text-slate-500">{JSON.stringify(r.stats)}</div></Td></tr>
          ))}</tbody>
        </Table>
      </Card>
    </>
  );
}

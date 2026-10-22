import { load, sp, type SP } from "../../_lib/page";
import { listAudit } from "@/server/services/audit";
import { listAgentActions } from "@/server/agent/runner";
import { Badge, Card, Input, PageHeader, Select, Table, Tabs, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { ConfigTabs } from "../nav";

export const metadata = { title: "Auditoría" };

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const tab = sp(q.tab) ?? "general";
  const d = await load(["audit.read"], async (ctx) => (tab === "agente" ? { agent: await listAgentActions(ctx), rows: [] } : { rows: await listAudit(ctx, { q: sp(q.q), source: sp(q.origen), from: sp(q.desde), to: sp(q.hasta) }), agent: [] }));
  return (
    <>
      <PageHeader title="Auditoría" subtitle="Registro inmutable de las acciones realizadas por usuarios, el asistente y las automatizaciones" />
      <ConfigTabs active="auditoria" />
      <Tabs active={tab} tabs={[{ key: "general", label: "Historial general", href: "/configuracion/auditoria" }, { key: "agente", label: "Acciones del asistente", href: "/configuracion/auditoria?tab=agente" }]} />
      {tab === "general" ? (
        <Card padded={false}>
          <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <Input name="q" placeholder="Buscar en el resumen" defaultValue={sp(q.q)} className="w-64" />
            <Select name="origen" defaultValue={sp(q.origen) ?? ""} className="w-40"><option value="">Todo origen</option><option value="ui">Usuario</option><option value="agent">Asistente</option><option value="automation">Automatización</option></Select>
            <Input type="date" name="desde" defaultValue={sp(q.desde)} className="w-40" /><Input type="date" name="hasta" defaultValue={sp(q.hasta)} className="w-40" />
            <button className="h-9 rounded-md border px-3 text-sm">Filtrar</button>
          </form>
          <Table>
            <thead><tr><Th>Fecha</Th><Th>Usuario</Th><Th>Origen</Th><Th>Acción</Th><Th>Resumen</Th></tr></thead>
            <tbody>{d.rows.map(({ a, user }) => <tr key={a.id}><Td className="text-xs">{formatDateTime(a.createdAt)}</Td><Td>{user ?? "Sistema"}</Td><Td><Badge tone={a.source === "agent" ? "blue" : a.source === "automation" ? "gray" : "green"}>{a.source}</Badge></Td><Td className="text-xs">{a.action}</Td><Td className="text-sm">{a.summary}</Td></tr>)}</tbody>
          </Table>
        </Card>
      ) : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Fecha</Th><Th>Instrucción original</Th><Th>Acción interpretada</Th><Th>Estado</Th><Th>Resultado / error</Th></tr></thead>
            <tbody>{d.agent.map((l) => (
              <tr key={l.id}><Td className="text-xs">{formatDateTime(l.createdAt)}</Td><Td className="max-w-64 text-xs">{l.instruction}</Td><Td className="text-xs"><code>{l.toolName}</code><div className="max-w-64 truncate text-slate-500">{JSON.stringify(l.toolInput)}</div></Td>
                <Td><Badge tone={l.status === "ejecutada" ? "green" : l.status === "pendiente_confirmacion" ? "yellow" : l.status === "rechazada" ? "gray" : "red"}>{l.status}</Badge>{l.confirmedAt && <div className="text-xs">Confirmada {formatDateTime(l.confirmedAt)}</div>}</Td>
                <Td className="max-w-80 text-xs">{l.error ?? (l.result as { summary?: string } | null)?.summary ?? "—"}</Td></tr>
            ))}</tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

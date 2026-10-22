import Link from "next/link";
import { load } from "../../_lib/page";
import { can } from "@/server/ctx";
import { getBoard } from "@/server/services/production";
import { listAssignableEmployees } from "@/server/services/employees";
import { Badge, Card, Field, Input, PageHeader, Progress, Select, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BOARD_STATUSES, SOCIAL_NETWORKS, deliverableStatuses, labelOf, type DeliverableKind } from "@/lib/domain";
import { formatDate, formatDateTime, formatPeriod } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { uploadDeliverableFileAction } from "../../_lib/file-actions";
import { addVariantAction, bulkCompleteAction, completeDeliverableAction, updateBoardAction, updateDeliverableAction } from "../actions";

const ALL_STATUSES = [...deliverableStatuses("reel"), ...deliverableStatuses("diseno")];

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(["production.read"], async (ctx, actor) => ({
    board: await getBoard(ctx, id),
    employees: await listAssignableEmployees(ctx),
    manage: can(ctx, "production.manage"),
    own: can(ctx, "production.update_own"),
    bulk: can(ctx, "production.bulk"),
    me: actor.employeeId,
    today: ctx.today,
  }));
  const b = d.board;
  const canEdit = (assigneeId: string | null) => !b.cancelledAt && (d.manage || (d.own && assigneeId === d.me));
  const design = b.deliverables.filter((x) => x.kind !== "reel");
  const video = b.deliverables.filter((x) => x.kind === "reel");

  const area = (title: string, list: typeof b.deliverables, group: "disenos" | "reels") => (
    <Card title={title} padded={false} actions={d.bulk && !b.cancelledAt && (
      <ActionForm action={bulkCompleteAction} inline><input type="hidden" name="boardId" value={b.id} /><input type="hidden" name="group" value={group} /><SubmitButton size="sm" variant="secondary">{group === "reels" ? "Marcar los reels como editados" : "Marcar los diseños como terminados"}</SubmitButton></ActionForm>
    )}>
      <Table>
        <thead><tr><Th>Entregable</Th><Th>Responsable</Th><Th>Fecha límite</Th><Th>Estado</Th><Th>Archivo final</Th><Th>Acciones</Th></tr></thead>
        <tbody>{list.map((x) => {
          const kind = x.kind as DeliverableKind;
          const late = !["finalizado", "editado"].includes(x.status) && x.dueDate && x.dueDate < d.today;
          const editable = canEdit(x.assigneeId);
          return (
            <tr key={x.id} className={late ? "bg-red-50/40" : ""}>
              <Td><div className="font-medium">{x.title}</div>{!x.countsTowardProgress && <Badge tone="blue">Variante (no suma)</Badge>}{x.scriptRef && <details className="text-xs text-slate-600"><summary className="cursor-pointer">Guion / referencia</summary><pre className="whitespace-pre-wrap font-sans">{x.scriptRef}</pre></details>}{x.notes && <div className="text-xs text-slate-500">{x.notes}</div>}</Td>
              <Td>{x.assignee ?? <Badge tone="yellow">Sin asignar</Badge>}</Td>
              <Td>{late ? <Badge tone="red">{formatDate(x.dueDate)}</Badge> : formatDate(x.dueDate)}</Td>
              <Td><StatusBadge list={deliverableStatuses(kind)} value={x.status} /></Td>
              <Td>{x.finalFileUrl ? <a href={x.finalFileUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">Abrir</a> : <span className="text-xs text-slate-400">Pendiente</span>}</Td>
              <Td className="min-w-72">
                {editable ? (
                  <ActionForm action={updateDeliverableAction} className="space-y-1.5">
                    <input type="hidden" name="id" value={x.id} /><input type="hidden" name="boardId" value={b.id} />
                    <div className="flex gap-1.5">
                      <Select name="status" defaultValue={x.status} className="h-8 text-xs">{deliverableStatuses(kind).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
                      <SubmitButton size="sm" variant="secondary">Guardar</SubmitButton>
                    </div>
                    <Input name="finalFileUrl" placeholder="Enlace al archivo final" defaultValue={x.finalFileUrl ?? ""} className="h-8 text-xs" />
                    {d.manage && (
                      <div className="flex gap-1.5">
                        <Select name="assigneeId" defaultValue={x.assigneeId ?? ""} className="h-8 text-xs"><option value="">Sin asignar</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select>
                        <Input type="date" name="dueDate" defaultValue={x.dueDate ?? ""} className="h-8 w-36 text-xs" />
                      </div>
                    )}
                    <Input name="notes" placeholder="Observaciones" defaultValue={x.notes ?? ""} className="h-8 text-xs" />
                  </ActionForm>
                ) : <span className="text-xs text-slate-400">Solo lectura</span>}
                {editable && (
                  <ActionForm action={uploadDeliverableFileAction} inline className="mt-1"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="boardId" value={b.id} /><input type="hidden" name="clientId" value={b.clientId} /><input type="file" name="file" required className="max-w-44 text-xs" /><SubmitButton size="sm" variant="ghost">Subir archivo</SubmitButton></ActionForm>
                )}
                {editable && !["finalizado", "editado"].includes(x.status) && x.finalFileUrl && (
                  <ActionForm action={completeDeliverableAction} inline className="mt-1"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="boardId" value={b.id} /><SubmitButton size="sm">✓ Marcar terminado</SubmitButton></ActionForm>
                )}
              </Td>
            </tr>
          );
        })}</tbody>
      </Table>
    </Card>
  );

  return (
    <>
      <PageHeader
        title={`${b.clientName} — ${formatPeriod(b.period)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge list={BOARD_STATUSES} value={b.status} />{b.readyAt && <Badge tone="green">Habilitado para Community Management desde {formatDateTime(b.readyAt)}</Badge>}<Link className="text-brand-700 underline" href={`/clientes/${b.clientId}?tab=produccion`}>Historial del cliente</Link></span>}
      />
      {b.cancelledAt && <div className="mb-4 rounded-md bg-slate-100 p-3 text-sm">Tablero cancelado: {b.cancelReason}. Se conserva como historial.</div>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Avance" value={formatPercent(b.progress)} hint={`${b.done}/${b.total} entregables`} tone={b.delayed ? "red" : b.done === b.total ? "green" : undefined} />
        <Stat label="Diseños" value={`${b.designs.done}/${b.designs.total}`} />
        <Stat label="Perfil y portada" value={`${b.profileCover.done}/${b.profileCover.total}`} />
        <Stat label="Reels" value={`${b.reels.done}/${b.reels.total}`} />
        <Stat label="Fecha límite" value={formatDate(b.dueDate)} hint={b.delayed ? `${b.overdueCount} entregable(s) atrasado(s)` : undefined} tone={b.delayed ? "red" : undefined} />
      </div>
      <div className="mb-4"><Progress value={b.progress} tone={b.delayed ? "red" : undefined} /></div>
      {d.manage && !b.cancelledAt && (
        <Card title="Responsables y fecha límite" className="mb-4">
          <ActionForm action={updateBoardAction} inline>
            <input type="hidden" name="id" value={b.id} />
            <Field label="Diseñador"><Select name="designerId" defaultValue={b.designerId ?? ""} className="w-48"><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
            <Field label="Editor de video"><Select name="editorId" defaultValue={b.editorId ?? ""} className="w-48"><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
            <Field label="Fecha límite"><Input type="date" name="dueDate" defaultValue={b.dueDate ?? ""} /></Field>
            <Field label="Observaciones"><Input name="notes" defaultValue={b.notes ?? ""} className="w-64" /></Field>
            <SubmitButton size="sm">Guardar</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <div className="space-y-4">
        {area("Área de Diseño", design, "disenos")}
        {area("Área de Video", video, "reels")}
      </div>
      {d.manage && !b.cancelledAt && (
        <Card title="Variante de perfil o portada por plataforma" className="mt-4">
          <ActionForm action={addVariantAction} inline>
            <input type="hidden" name="boardId" value={b.id} />
            <Select name="kind" className="w-40"><option value="portada">Portada</option><option value="perfil">Foto de perfil</option></Select>
            <Select name="platform" className="w-40">{SOCIAL_NETWORKS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}</Select>
            <SubmitButton size="sm" variant="secondary">Agregar variante</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card title="Historial de cambios" className="mt-4">
        <ol className="space-y-1 text-sm">{b.events.map((e) => (
          <li key={e.id}><span className="text-xs text-slate-500">{formatDateTime(e.createdAt)}</span> · {e.title}: {e.fromStatus !== e.toStatus ? `${labelOf(ALL_STATUSES, e.fromStatus)} → ${labelOf(ALL_STATUSES, e.toStatus)}` : "datos actualizados"}{e.note && ` · ${e.note}`}</li>
        ))}</ol>
      </Card>
    </>
  );
}

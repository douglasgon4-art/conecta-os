import Link from "next/link";
import { load } from "../../_lib/page";
import { can } from "@/server/ctx";
import { getPlan } from "@/server/services/strategy";
import { getBoardByClientPeriod } from "@/server/services/production";
import { listAssignableEmployees } from "@/server/services/employees";
import { Badge, Card, Field, Input, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DESIGN_STATUSES, PLAN_STATUSES, VIDEO_STATUSES } from "@/lib/domain";
import { formatDateTime, formatPeriod } from "@/lib/dates";
import { duplicatePlanAction, setPlanStatusAction, updateItemAction, updatePlanAction } from "../actions";

const NEXT: Record<string, { to: string; label: string; perm?: "approve" }[]> = {
  pendiente_planificacion: [{ to: "en_planificacion", label: "Comenzar planificación" }],
  en_planificacion: [{ to: "revision_interna", label: "Enviar a revisión interna" }, { to: "pendiente_aprobacion_cliente", label: "Enviar al cliente" }, { to: "aprobada", label: "Aprobar", perm: "approve" }],
  revision_interna: [{ to: "pendiente_aprobacion_cliente", label: "Enviar al cliente" }, { to: "cambios_solicitados", label: "Solicitar cambios" }, { to: "aprobada", label: "Aprobar", perm: "approve" }],
  pendiente_aprobacion_cliente: [{ to: "aprobada", label: "Cliente aprobó", perm: "approve" }, { to: "cambios_solicitados", label: "Cliente pidió cambios" }],
  cambios_solicitados: [{ to: "en_planificacion", label: "Volver a planificación" }, { to: "pendiente_aprobacion_cliente", label: "Reenviar al cliente" }],
  aprobada: [{ to: "cambios_solicitados", label: "Reabrir por cambios" }],
  en_produccion: [{ to: "cambios_solicitados", label: "Reabrir por cambios" }],
  completada: [],
};

export default async function PlanDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(["strategy.read"], async (ctx) => {
    const plan = await getPlan(ctx, id);
    return {
      plan,
      board: can(ctx, "production.read") ? await getBoardByClientPeriod(ctx, plan.clientId, plan.period) : null,
      employees: await listAssignableEmployees(ctx),
      canWrite: can(ctx, "strategy.write"),
      canApprove: can(ctx, "strategy.approve"),
    };
  });
  const p = d.plan;
  const editable = d.canWrite && !p.cancelledAt;
  const area = (name: keyof typeof p, label: string) => (
    <Field label={label}><Textarea name={name} defaultValue={(p[name] as string) ?? ""} rows={3} disabled={!editable} /></Field>
  );
  const items = (kind: "reel" | "diseno") => p.items.filter((i) => i.kind === kind);
  return (
    <>
      <PageHeader
        title={`${p.clientName} · ${formatPeriod(p.period)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge list={PLAN_STATUSES} value={p.status} />{p.approvedAt && <span>Aprobada el {formatDateTime(p.approvedAt)}</span>}{d.board && <Link href={`/produccion/${d.board.id}`} className="text-brand-700 underline">Tablero de producción ({d.board.done}/{d.board.total})</Link>}</span>}
        actions={editable && NEXT[p.status]?.filter((n) => n.perm !== "approve" || d.canApprove).map((n) => (
          <ActionForm key={n.to} action={setPlanStatusAction} inline><input type="hidden" name="id" value={p.id} /><input type="hidden" name="status" value={n.to} /><SubmitButton size="sm" variant={n.to === "aprobada" ? "primary" : "secondary"}>{n.label}</SubmitButton></ActionForm>
        ))}
      />
      {p.cancelledAt && <div className="mb-4 rounded-md bg-slate-100 p-3 text-sm">Planificación cancelada: {p.cancelReason}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Planificación del mes" className="lg:col-span-2">
          <ActionForm action={updatePlanAction}>
            <input type="hidden" name="id" value={p.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Estratega responsable"><Select name="strategistId" defaultValue={p.strategistId ?? ""} disabled={!editable}><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
              <Field label="Fecha límite"><Input type="date" name="dueDate" defaultValue={p.dueDate ?? ""} disabled={!editable} /></Field>
              {area("objectives", "Objetivos")}
              {area("targetAudience", "Público objetivo")}
              {area("pillars", "Pilares de contenido")}
              {area("campaigns", "Campañas")}
              {area("themes", "Temas")}
              {area("creativeConcepts", "Conceptos creativos")}
              {area("visualReferences", "Referencias visuales")}
              {area("ctas", "Llamadas a la acción")}
            </div>
            {area("notes", "Observaciones")}
            {editable && <SubmitButton>Guardar planificación</SubmitButton>}
          </ActionForm>
        </Card>
        <div className="space-y-4">
          {editable && p.previous.length > 0 && ["pendiente_planificacion", "en_planificacion", "cambios_solicitados"].includes(p.status) && (
            <Card title="Usar un mes anterior como punto de partida">
              <ActionForm action={duplicatePlanAction}>
                <input type="hidden" name="id" value={p.id} />
                <Select name="sourceId">{p.previous.map((x) => <option key={x.id} value={x.id}>{formatPeriod(x.period)}</option>)}</Select>
                <SubmitButton variant="secondary" size="sm">Duplicar (pide confirmación)</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title="Cómo funciona">
            <p className="text-sm text-slate-600">Al aprobar, cada reel y diseño se vincula a su entregable del tablero de {formatPeriod(p.period)} con el tema, guion y referencias, sin volver a escribirlos. Guardar o aprobar de nuevo no duplica nada.</p>
          </Card>
        </div>
      </div>
      {(["reel", "diseno"] as const).map((kind) => (
        <Card key={kind} title={kind === "reel" ? `Reels (${items(kind).length})` : `Diseños (${items(kind).length})`} className="mt-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {items(kind).map((it) => (
              <ActionForm key={it.id} action={updateItemAction} className="rounded-lg border border-slate-200 p-3">
                <input type="hidden" name="itemId" value={it.id} /><input type="hidden" name="planId" value={p.id} />
                <div className="flex items-center justify-between"><strong className="text-sm">{kind === "reel" ? "Reel" : "Diseño"} {it.position}</strong>{it.deliverableStatus ? <StatusBadge list={kind === "reel" ? VIDEO_STATUSES : DESIGN_STATUSES} value={it.deliverableStatus} /> : <Badge>Sin enviar a producción</Badge>}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Tema"><Input name="theme" defaultValue={it.theme ?? ""} disabled={!editable} /></Field>
                  <Field label="Objetivo"><Input name="objective" defaultValue={it.objective ?? ""} disabled={!editable} /></Field>
                  <Field label="Gancho"><Input name="hook" defaultValue={it.hook ?? ""} disabled={!editable} /></Field>
                  <Field label="Llamada a la acción"><Input name="cta" defaultValue={it.cta ?? ""} disabled={!editable} /></Field>
                  <Field label="Fecha tentativa de publicación"><Input type="date" name="tentativePublishDate" defaultValue={it.tentativePublishDate ?? ""} disabled={!editable} /></Field>
                  <Field label="Responsable"><Select name="responsibleId" defaultValue={it.responsibleId ?? ""} disabled={!editable}><option value="">—</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
                </div>
                <Field label={kind === "reel" ? "Guion" : "Idea / copy"}><Textarea name="script" defaultValue={it.script ?? ""} rows={2} disabled={!editable} /></Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Idea central"><Input name="centralIdea" defaultValue={it.centralIdea ?? ""} disabled={!editable} /></Field>
                  <Field label="Referencias"><Input name="references" defaultValue={it.references ?? ""} disabled={!editable} /></Field>
                </div>
                {editable && <SubmitButton size="sm" variant="secondary">Guardar {kind === "reel" ? "reel" : "diseño"} {it.position}</SubmitButton>}
              </ActionForm>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}

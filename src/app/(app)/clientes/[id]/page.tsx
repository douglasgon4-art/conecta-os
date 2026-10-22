import Link from "next/link";
import { load, sp, type SP } from "../../_lib/page";
import { can } from "@/server/ctx";
import { clientActivity, getClient, listPackages, offboardingPreview } from "@/server/services/clients";
import { clientSessions } from "@/server/services/sessions";
import { clientPlans } from "@/server/services/strategy";
import { clientBoards } from "@/server/services/production";
import { listPublications } from "@/server/services/publications";
import { listInvoices } from "@/server/services/invoices";
import { listTasks } from "@/server/services/tasks";
import { listAssignableEmployees } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { and, desc, eq, inArray } from "drizzle-orm";
import { productionBoards, productionDeliverables, employees as employeesTable } from "@/server/db/schema";
import { Badge, Card, DL, Empty, Field, Input, PageHeader, Progress, Select, StatusBadge, Table, Tabs, Td, Textarea, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClientFields } from "@/components/forms/client-fields";
import { ContractFields } from "@/components/forms/contract-fields";
import {
  BOARD_STATUSES,
  CLIENT_STATUSES,
  DESIGN_STATUSES,
  INVOICE_STATUSES,
  PLAN_STATUSES,
  PUBLICATION_STATUSES,
  SESSION_STATUSES,
  SOCIAL_NETWORKS,
  TASK_STATUSES,
  VIDEO_STATUSES,
  labelOf,
} from "@/lib/domain";
import { addDays, firstOfMonth, formatDate, formatDateTime, formatPeriod } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { listFiles } from "@/server/services/files";
import { uploadClientDocumentAction } from "../../_lib/file-actions";
import { archiveAction, offboardAction, reactivateAction, reinitializeAction, setStatusAction, updateClientAction, updateContractAction } from "../actions";

const TABS = [
  ["resumen", "Resumen"],
  ["agenda", "Agenda"],
  ["estrategia", "Estrategia y campañas"],
  ["produccion", "Producción"],
  ["disenos", "Diseños"],
  ["videos", "Videos"],
  ["publicaciones", "Publicaciones"],
  ["aprobaciones", "Aprobaciones"],
  ["administracion", "Administración y contrato"],
  ["facturacion", "Facturación y pagos"],
  ["historial", "Historial"],
] as const;

export default async function ClientDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const q = await searchParams;
  const tab = sp(q.tab) ?? "resumen";
  const d = await load(["clients.read"], async (ctx) => {
    const client = await getClient(ctx, id);
    const perms = {
      write: can(ctx, "clients.write"),
      archive: can(ctx, "clients.archive"),
      finance: can(ctx, "finance.read"),
      sessions: can(ctx, "sessions.read"),
      strategy: can(ctx, "strategy.read"),
      production: can(ctx, "production.read"),
      publications: can(ctx, "publications.read"),
    };
    const data: Record<string, unknown> = {};
    if (tab === "resumen") {
      if (perms.sessions) data.sessions = await clientSessions(ctx, id);
      if (perms.production) data.boards = (await clientBoards(ctx, id)).slice(0, 3);
      if (perms.finance) data.invoices = (await listInvoices(ctx, { clientId: id, status: "abiertas" })).slice(0, 5);
      data.tasks = await listTasks(ctx, { scope: "todas", clientId: id });
    }
    if (tab === "agenda" && perms.sessions) data.sessions = await clientSessions(ctx, id);
    if ((tab === "estrategia" || tab === "aprobaciones") && perms.strategy) data.plans = await clientPlans(ctx, id);
    if (tab === "produccion" && perms.production) data.boards = await clientBoards(ctx, id);
    if ((tab === "disenos" || tab === "videos") && perms.production) {
      const kinds = tab === "videos" ? ["reel"] : ["diseno", "perfil", "portada"];
      data.deliverables = await ctx.tx
        .select({ d: productionDeliverables, period: productionBoards.period, assignee: employeesTable.fullName })
        .from(productionDeliverables)
        .innerJoin(productionBoards, eq(productionBoards.id, productionDeliverables.boardId))
        .leftJoin(employeesTable, eq(employeesTable.id, productionDeliverables.assigneeId))
        .where(and(eq(productionDeliverables.clientId, id), inArray(productionDeliverables.kind, kinds)))
        .orderBy(desc(productionBoards.period), productionDeliverables.kind, productionDeliverables.position)
        .limit(120);
    }
    if (tab === "publicaciones" && perms.publications) data.pubs = await listPublications(ctx, { from: addDays(ctx.today, -45), to: addDays(ctx.today, 45), clientId: id });
    if (tab === "administracion") {
      data.packages = await listPackages(ctx);
      data.files = await listFiles(ctx, "client_document", id);
      data.employees = await listAssignableEmployees(ctx);
      if (perms.archive && !["archivado", "dado_de_baja"].includes(client.status)) data.preview = await offboardingPreview(ctx, id, firstOfMonth(ctx.today));
    }
    if (tab === "facturacion" && perms.finance) data.invoices = await listInvoices(ctx, { clientId: id });
    if (tab === "historial") data.activity = await clientActivity(ctx, id);
    return { client, perms, data, today: ctx.today, settings: await getSettings(ctx) };
  });
  const { client: c, perms, data } = d;
  const href = (t: string) => `/clientes/${id}?tab=${t}`;
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const D = data as Any;

  return (
    <>
      <PageHeader
        title={c.tradeName}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge list={CLIENT_STATUSES} value={c.status} />{c.city && <span>{c.city}, {c.country}</span>}{c.contract && <span>· {c.contract.name}</span>}</span>}
      />
      {sp(q.creado) && <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Cliente creado. Sus espacios de trabajo se generaron automáticamente: {c.workspaces.join(", ")}.</div>}
      <Tabs active={tab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: href(k) }))} />

      {tab === "resumen" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Ficha" className="lg:col-span-2">
            <DL items={[
              ["Razón social", c.legalName], ["RUC", c.taxId], ["Contacto", c.contactName], ["Teléfono", c.phone], ["Correo", c.email],
              ["Dirección", c.address], ["Sitio web", c.website], ["Responsable de la cuenta", c.accountManager],
              ["Inicio del servicio", formatDate(c.serviceStartDate)], ["Fin del servicio", formatDate(c.serviceEndDate)],
              ["Redes", Object.entries(c.socialLinks ?? {}).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="mr-2 text-brand-700 underline">{labelOf(SOCIAL_NETWORKS, k)}</a>)],
              ["Observaciones", c.notes],
            ]} />
          </Card>
          <Card title="Contrato vigente">
            {c.contract ? (
              <DL items={[
                ["Paquete", c.contract.name],
                ...(perms.finance ? [["Precio mensual", formatMoney(c.contract.monthlyPrice, c.contract.currency)] as [string, string]] : []),
                ["Día de pago", c.contract.billingDay],
                ["Artes / reels", `${c.contract.designsPerMonth} artes · ${c.contract.reelsPerMonth} reels`],
                ["Perfil / portada", `${c.contract.includeProfilePhoto ? "Sí" : "No"} / ${c.contract.includeCover ? "Sí" : "No"}`],
                ["Sesión", c.contract.sessionsEnabled ? `Cada ${c.contract.sessionFrequencyMonths} mes(es)` : "No incluida"],
                ["Redes", c.contract.socialNetworks.map((n) => labelOf(SOCIAL_NETWORKS, n)).join(", ") || "—"],
              ]} />
            ) : <Empty>Sin contrato vigente.</Empty>}
          </Card>
          {D.sessions && (
            <Card title="Sesiones de contenido">
              <DL items={[
                ["Última realizada", D.sessions.last ? formatDate(D.sessions.last.completedDate) : "—"],
                ["Próxima", D.sessions.next ? <span className="flex flex-col gap-1">{formatDate(D.sessions.next.date)}<Badge tone={D.sessions.next.alert.tone}>{D.sessions.next.alert.label}</Badge></span> : "—"],
              ]} />
            </Card>
          )}
          {D.boards && (
            <Card title="Producción reciente">
              {D.boards.length ? D.boards.map((b: Any) => (
                <Link key={b.id} href={`/produccion/${b.id}`} className="mb-3 block">
                  <div className="flex justify-between text-sm"><span className="font-medium">{formatPeriod(b.period)}</span><StatusBadge list={BOARD_STATUSES} value={b.cancelledAt ? "pendiente" : b.status} /></div>
                  <Progress value={b.progress} tone={b.delayed ? "red" : undefined} />
                  <div className="mt-1 text-xs text-slate-500">{b.done}/{b.total} · diseños {b.designs.done}/{b.designs.total} · perfil/portada {b.profileCover.done}/{b.profileCover.total} · reels {b.reels.done}/{b.reels.total}</div>
                </Link>
              )) : <Empty>Sin tableros.</Empty>}
            </Card>
          )}
          {D.invoices && (
            <Card title="Cuentas por cobrar abiertas">
              {D.invoices.length ? (
                <ul className="space-y-2 text-sm">{D.invoices.map((i: Any) => <li key={i.id} className="flex justify-between"><Link href={`/finanzas/facturas/${i.id}`} className="hover:underline">{i.number}</Link><span className="tabular">{formatMoney(i.balance, i.currency)}</span><StatusBadge list={INVOICE_STATUSES} value={i.status} /></li>)}</ul>
              ) : <Empty>Sin saldos pendientes.</Empty>}
            </Card>
          )}
          <Card title="Tareas abiertas" className="lg:col-span-3">
            {D.tasks?.length ? (
              <Table><thead><tr><Th>Tarea</Th><Th>Departamento</Th><Th>Responsable</Th><Th>Vence</Th><Th>Estado</Th></tr></thead>
                <tbody>{D.tasks.map((t: Any) => <tr key={t.task.id}><Td>{t.task.title}</Td><Td>{t.task.department ?? "—"}</Td><Td>{t.assignee ?? <Badge tone="yellow">Sin asignar</Badge>}</Td><Td>{formatDate(t.task.dueDate)}</Td><Td><StatusBadge list={TASK_STATUSES} value={t.task.status} /></Td></tr>)}</tbody>
              </Table>
            ) : <Empty>No hay tareas abiertas.</Empty>}
          </Card>
        </div>
      )}

      {tab === "agenda" && (D.sessions ? (
        <Card title="Historial de sesiones" actions={<Link href="/agenda" className="text-xs text-brand-700">Abrir agenda general</Link>} padded={false}>
          <Table><thead><tr><Th>Prevista</Th><Th>Propuesta</Th><Th>Confirmada</Th><Th>Realizada</Th><Th>Responsable</Th><Th>Estado</Th><Th>Alerta</Th></tr></thead>
            <tbody>{D.sessions.sessions.map((s: Any) => (
              <tr key={s.id}><Td>{formatDate(s.expectedDate)}</Td><Td>{formatDate(s.proposedDate)}</Td><Td>{formatDate(s.confirmedDate)}{s.startTime && ` ${s.startTime.slice(0, 5)}`}</Td><Td>{formatDate(s.completedDate)}</Td><Td>{s.responsible ?? "—"}</Td><Td><StatusBadge list={SESSION_STATUSES} value={s.status} /></Td><Td><Link href={`/agenda?sesion=${s.id}`}><Badge tone={s.alert.tone}>{s.alert.label}</Badge></Link></Td></tr>
            ))}</tbody>
          </Table>
        </Card>
      ) : <Empty>Sin acceso a la agenda.</Empty>)}

      {(tab === "estrategia" || tab === "aprobaciones") && (D.plans ? (
        <Card title={tab === "estrategia" ? "Planificaciones mensuales" : "Aprobaciones de contenido"} padded={false}>
          <Table><thead><tr><Th>Mes</Th><Th>Estratega</Th><Th>Fecha límite</Th><Th>Elementos definidos</Th><Th>Estado</Th>{tab === "aprobaciones" && <Th>Aprobada</Th>}</tr></thead>
            <tbody>{D.plans.map((p: Any) => (
              <tr key={p.plan.id}><Td><Link className="font-medium hover:underline" href={`/estrategia/${p.plan.id}`}>{formatPeriod(p.plan.period)}</Link></Td><Td>{p.strategist ?? "—"}</Td><Td>{formatDate(p.plan.dueDate)}</Td><Td className="tabular">{p.filled}/{p.total}</Td><Td><StatusBadge list={PLAN_STATUSES} value={p.plan.status} /></Td>{tab === "aprobaciones" && <Td>{p.plan.approvedAt ? formatDateTime(p.plan.approvedAt) : "—"}</Td>}</tr>
            ))}</tbody>
          </Table>
        </Card>
      ) : <Empty>Sin acceso a estrategia.</Empty>)}

      {tab === "produccion" && (D.boards ? (
        <Card title="Tableros mensuales (historial completo)" padded={false}>
          <Table><thead><tr><Th>Mes</Th><Th>Diseños</Th><Th>Perfil y portada</Th><Th>Reels</Th><Th className="w-40">Avance</Th><Th>Estado</Th></tr></thead>
            <tbody>{D.boards.map((b: Any) => (
              <tr key={b.id}><Td><Link className="font-medium hover:underline" href={`/produccion/${b.id}`}>{formatPeriod(b.period)}</Link></Td><Td>{b.designs.done}/{b.designs.total}</Td><Td>{b.profileCover.done}/{b.profileCover.total}</Td><Td>{b.reels.done}/{b.reels.total}</Td><Td><div className="flex items-center gap-2"><Progress value={b.progress} /><span className="text-xs">{formatPercent(b.progress)}</span></div></Td><Td>{b.cancelledAt ? <Badge>Cancelado</Badge> : <StatusBadge list={BOARD_STATUSES} value={b.status} />}</Td></tr>
            ))}</tbody>
          </Table>
        </Card>
      ) : <Empty>Sin acceso a producción.</Empty>)}

      {(tab === "disenos" || tab === "videos") && (D.deliverables ? (
        <Card title={tab === "videos" ? "Reels" : "Artes, perfil y portada"} padded={false}>
          <Table><thead><tr><Th>Mes</Th><Th>Entregable</Th><Th>Responsable</Th><Th>Fecha límite</Th><Th>Archivo</Th><Th>Estado</Th></tr></thead>
            <tbody>{D.deliverables.map((r: Any) => (
              <tr key={r.d.id}><Td>{formatPeriod(r.period)}</Td><Td><Link className="hover:underline" href={`/produccion/${r.d.boardId}`}>{r.d.title}</Link></Td><Td>{r.assignee ?? "—"}</Td><Td>{formatDate(r.d.dueDate)}</Td><Td>{r.d.finalFileUrl ? <a className="text-brand-700 underline" href={r.d.finalFileUrl} target="_blank" rel="noreferrer">Abrir</a> : "—"}</Td><Td><StatusBadge list={r.d.kind === "reel" ? VIDEO_STATUSES : DESIGN_STATUSES} value={r.d.status} /></Td></tr>
            ))}</tbody>
          </Table>
        </Card>
      ) : <Empty>Sin acceso a producción.</Empty>)}

      {tab === "publicaciones" && (D.pubs ? (
        <Card title="Publicaciones (±45 días)" padded={false} actions={<Link href="/publicaciones" className="text-xs text-brand-700">Control diario</Link>}>
          {D.pubs.length ? (
            <Table><thead><tr><Th>Fecha</Th><Th>Red</Th><Th>Contenido</Th><Th>Responsable</Th><Th>Evidencia</Th><Th>Estado</Th></tr></thead>
              <tbody>{D.pubs.map((p: Any) => (
                <tr key={p.p.id}><Td>{formatDate(p.p.scheduledDate)}</Td><Td>{labelOf(SOCIAL_NETWORKS, p.p.network)}</Td><Td>{p.p.contentTitle}</Td><Td>{p.responsible ?? "—"}</Td><Td>{p.p.evidenceUrl ? <a className="text-brand-700 underline" href={p.p.evidenceUrl} target="_blank" rel="noreferrer">Ver</a> : "—"}</Td><Td><StatusBadge list={PUBLICATION_STATUSES} value={p.p.status} /></Td></tr>
              ))}</tbody>
            </Table>
          ) : <div className="p-4"><Empty>No hay publicaciones en este rango.</Empty></div>}
        </Card>
      ) : <Empty>Sin acceso a publicaciones.</Empty>)}

      {tab === "administracion" && (
        <div className="space-y-4">
          {perms.write ? (
            <>
              <Card title="Editar ficha">
                <ActionForm action={updateClientAction}>
                  <input type="hidden" name="id" value={id} />
                  <ClientFields employees={D.employees} value={c} />
                  <div className="flex justify-end"><SubmitButton>Guardar ficha</SubmitButton></div>
                </ActionForm>
              </Card>
              {c.contract && (
                <Card title="Contrato vigente">
                  <ActionForm action={updateContractAction}>
                    <input type="hidden" name="id" value={id} />
                    <ContractFields packages={D.packages} value={c.contract} showFirstSession={false} showStart={false} />
                    <div className="flex justify-end"><SubmitButton>Guardar contrato</SubmitButton></div>
                  </ActionForm>
                </Card>
              )}
              <Card title="Espacios de trabajo">
                <p className="mb-3 text-sm text-slate-600">Módulos inicializados: {c.workspaces.join(", ") || "ninguno"}. Puedes verificar que no falte nada; el proceso es idempotente y no duplica registros.</p>
                <ActionForm action={reinitializeAction} inline><input type="hidden" name="id" value={id} /><SubmitButton variant="secondary" size="sm">Verificar y completar espacios</SubmitButton></ActionForm>
              </Card>
            </>
          ) : <Empty>Solo lectura.</Empty>}

          <Card title="Ciclo de vida del cliente">
            <div className="grid gap-4 lg:grid-cols-2">
              {perms.write && ["en_incorporacion", "en_pausa"].includes(c.status) && (
                <ActionForm action={setStatusAction} inline><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="activo" /><SubmitButton variant="secondary" size="sm">Marcar como activo</SubmitButton></ActionForm>
              )}
              {perms.write && ["activo", "en_incorporacion"].includes(c.status) && (
                <ActionForm action={setStatusAction} inline><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value="en_pausa" /><Input name="reason" placeholder="Motivo de la pausa" className="w-56" /><SubmitButton variant="secondary" size="sm">Poner en pausa</SubmitButton></ActionForm>
              )}
            </div>
            {perms.archive && !["archivado", "dado_de_baja"].includes(c.status) && (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <h3 className="mb-2 text-sm font-semibold">Archivar cliente</h3>
                  <ActionForm action={archiveAction}>
                    <input type="hidden" name="id" value={id} />
                    <Field label="Motivo *"><Input name="reason" required /></Field>
                    <SubmitButton variant="secondary" size="sm">Archivar</SubmitButton>
                  </ActionForm>
                </div>
                <div className="rounded-lg border border-red-200 p-3">
                  <h3 className="mb-2 text-sm font-semibold text-red-800">Dar de baja</h3>
                  {D.preview && (
                    <div className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                      <div className="font-semibold">Obligaciones pendientes</div>
                      <div>Cobros: {D.preview.pendingInvoices.length} factura(s) abiertas · saldo {Object.entries(D.preview.balance).map(([cur, v]) => formatMoney(v as number, cur)).join(" + ") || "0"}</div>
                      <div>Entregas: {D.preview.openDeliverables.map((x: Any) => `${x.label}: ${x.open} pendientes`).join(" · ") || "ninguna"}</div>
                      <div>Sesiones abiertas: {D.preview.openSessions.length} · Tableros futuros: {D.preview.futureBoards.length}</div>
                    </div>
                  )}
                  <ActionForm action={offboardAction}>
                    <input type="hidden" name="id" value={id} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Fecha efectiva *"><Input type="date" name="effectiveDate" required defaultValue={d.today} /></Field>
                      <Field label="Último período de servicio *"><Input type="month" name="lastServicePeriodMonth" required defaultValue={d.today.slice(0, 7)} /></Field>
                      <Field label="Responsable"><Select name="responsibleId" defaultValue=""><option value="">—</option>{D.employees.map((e: Any) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></Field>
                      <Field label="Sesiones futuras"><Select name="futureSessionsDecision"><option value="cancelar">Cancelar</option><option value="conservar">Conservar como pendientes</option></Select></Field>
                    </div>
                    <Field label="Motivo *"><Input name="reason" required /></Field>
                    <Field label="Observaciones (estado de cobros, entregas y sesiones)"><Textarea name="notes" rows={2} /></Field>
                    <SubmitButton variant="danger" size="sm">Registrar baja</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            )}
            {perms.archive && ["archivado", "dado_de_baja", "en_pausa"].includes(c.status) && D.packages && (
              <div className="mt-4 rounded-lg border border-emerald-200 p-3">
                <h3 className="mb-2 text-sm font-semibold text-emerald-800">Reactivar cliente</h3>
                <ActionForm action={reactivateAction}>
                  <input type="hidden" name="id" value={id} />
                  <ContractFields packages={D.packages} value={c.contracts[0] ? { ...c.contracts[0], startDate: d.today, endDate: null } : { startDate: d.today }} />
                  <Field label="Motivo"><Input name="reason" /></Field>
                  <SubmitButton size="sm">Reactivar con este contrato</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>
          <Card title="Documentos y contrato">
            {D.files?.length ? (
              <ul className="mb-3 space-y-1 text-sm">{D.files.map((f: Any) => <li key={f.id}><a className="text-brand-700 underline" href={`/api/archivos/${f.id}`} target="_blank" rel="noreferrer">{f.originalName}</a> <span className="text-xs text-slate-500">· {Math.round(f.sizeBytes / 1024)} KB · {formatDateTime(f.createdAt)}</span></li>)}</ul>
            ) : <p className="mb-3 text-sm text-slate-500">Sin documentos.</p>}
            {perms.write && (
              <ActionForm action={uploadClientDocumentAction} inline><input type="hidden" name="clientId" value={id} /><input type="file" name="file" required className="text-sm" /><SubmitButton size="sm" variant="secondary">Subir documento</SubmitButton></ActionForm>
            )}
          </Card>
          <Card title="Contratos anteriores" padded={false}>
            <Table><thead><tr><Th>Contrato</Th><Th>Inicio</Th><Th>Fin</Th>{perms.finance && <Th>Precio</Th>}<Th>Estado</Th></tr></thead>
              <tbody>{c.contracts.map((k) => <tr key={k.id}><Td>{k.name}</Td><Td>{formatDate(k.startDate)}</Td><Td>{formatDate(k.endDate)}</Td>{perms.finance && <Td>{formatMoney(k.monthlyPrice, k.currency)}</Td>}<Td>{k.status}</Td></tr>)}</tbody>
            </Table>
          </Card>
        </div>
      )}

      {tab === "facturacion" && (D.invoices ? (
        <Card title="Facturación y pagos" padded={false} actions={<Link href={`/finanzas/facturas?cliente=${id}`} className="text-xs text-brand-700">Ir a finanzas</Link>}>
          {D.invoices.length ? (
            <Table><thead><tr><Th>Número</Th><Th>Concepto</Th><Th>Emisión</Th><Th>Vence</Th><Th>Importe</Th><Th>Pagado</Th><Th>Saldo</Th><Th>Estado</Th></tr></thead>
              <tbody>{D.invoices.map((i: Any) => (
                <tr key={i.id}><Td><Link className="font-medium hover:underline" href={`/finanzas/facturas/${i.id}`}>{i.number}</Link></Td><Td>{i.concept}</Td><Td>{formatDate(i.issueDate)}</Td><Td>{formatDate(i.dueDate)}</Td><Td className="tabular">{formatMoney(i.amount, i.currency)}</Td><Td className="tabular">{formatMoney(i.paidAmount, i.currency)}</Td><Td className="tabular">{formatMoney(i.balance, i.currency)}</Td><Td><StatusBadge list={INVOICE_STATUSES} value={i.status} /></Td></tr>
              ))}</tbody>
            </Table>
          ) : <div className="p-4"><Empty>Sin facturas.</Empty></div>}
        </Card>
      ) : <Empty>Tu rol no tiene acceso a la información financiera.</Empty>)}

      {tab === "historial" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Actividad" className="lg:col-span-2">
            <ol className="space-y-3">{D.activity.map((a: Any) => (
              <li key={a.id} className="text-sm"><div className="text-xs text-slate-500">{formatDateTime(a.createdAt)} · {a.source === "agent" ? "Asistente" : a.source === "automation" ? "Automatización" : "Usuario"}</div>{a.summary}</li>
            ))}</ol>
          </Card>
          <Card title="Cambios de estado">
            <ol className="space-y-2 text-sm">{c.statusHistory.map((h) => (
              <li key={h.id}><div className="text-xs text-slate-500">{formatDateTime(h.createdAt)}</div>{h.fromStatus ? `${labelOf(CLIENT_STATUSES, h.fromStatus)} → ` : ""}<strong>{labelOf(CLIENT_STATUSES, h.toStatus)}</strong>{h.reason && <span className="text-slate-500"> · {h.reason}</span>}</li>
            ))}</ol>
          </Card>
        </div>
      )}
    </>
  );
}

import { load } from "../../_lib/page";
import { can } from "@/server/ctx";
import { getEmployee } from "@/server/services/employees";
import { aguinaldoEstimate, vacationBalance } from "@/server/services/payroll";
import { listRolesWithPermissions } from "@/server/services/users";
import { AppError } from "@/server/errors";
import { Badge, Card, DL, Field, Input, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EmployeeFields } from "@/components/forms/employee-fields";
import { CONTRACT_TYPES, DEPARTMENTS, EMPLOYEE_STATUSES, PAY_FREQUENCIES, VACATION_STATUSES, labelOf } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createUserForEmployeeAction, leaveAdjustmentAction, salaryAction, updateEmployeeAction, vacationDecisionAction, vacationRequestAction } from "../actions";

const safe = async <T,>(p: Promise<T>) => p.catch((e) => (e instanceof AppError ? null : Promise.reject(e)));

export default async function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(["employees.read"], async (ctx) => ({
    e: await getEmployee(ctx, id),
    vac: can(ctx, "leave.read") || can(ctx, "payroll.read") ? await safe(vacationBalance(ctx, id)) : null,
    ag: can(ctx, "payroll.read") ? await safe(aguinaldoEstimate(ctx, id)) : null,
    roles: can(ctx, "settings.manage") ? (await listRolesWithPermissions(ctx)).roles : null,
    write: can(ctx, "employees.write"),
    salary: can(ctx, "employees.salary"),
    leaveWrite: can(ctx, "leave.write"),
    leaveApprove: can(ctx, "leave.approve"),
    today: ctx.today,
  }));
  const e = d.e;
  return (
    <>
      <PageHeader title={e.fullName} subtitle={<span className="flex items-center gap-2"><StatusBadge list={EMPLOYEE_STATUSES} value={e.status} />{e.position} · {labelOf(DEPARTMENTS, e.departmentKey)}</span>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Ficha laboral" className="lg:col-span-2">
          <DL items={[["Teléfono", e.phone], ["Correo", e.email], ["Fecha de contratación", formatDate(e.hireDate)], ["Fecha de inicio", formatDate(e.startDate)], ["Tipo de contrato", labelOf(CONTRACT_TYPES, e.contractType)], ["Jornada", e.workSchedule], ["Forma de pago", labelOf(PAY_FREQUENCIES, e.payFrequency)], ["Salario vigente", e.currentSalary ? formatMoney(e.currentSalary.salary, e.currentSalary.currency) : d.salary ? "Sin salario registrado" : "Restringido"], ["Terminación", formatDate(e.terminationDate)], ["Usuario del sistema", e.user ? `${e.user.email}${e.user.isActive ? "" : " (inactivo)"}` : "Sin acceso"]]} />
        </Card>
        <div className="space-y-4">
          {d.ag && (
            <Card title="Aguinaldo (décimo tercer mes)">
              <div className="text-2xl font-semibold tabular">{formatMoney(d.ag.amount, d.ag.currency)}</div>
              <p className="mt-1 text-xs text-slate-600">Acumulado estimado al {formatDate(d.today)} · período {formatDate(d.ag.periodStart)} – {formatDate(d.ag.periodEnd)} · {d.ag.daysConsidered} días · base {formatMoney(d.ag.base, d.ag.currency)} ({d.ag.baseDetail})</p>
              <p className="mt-1 text-xs text-slate-500">{d.ag.formula}</p>
              {d.ag.estimate && <Badge tone="yellow" className="mt-2">Estimación: reglas {d.ag.rules.version} sin validar</Badge>}
            </Card>
          )}
          {d.vac && (
            <Card title="Vacaciones">
              <div className="text-2xl font-semibold tabular">{d.vac.balance} días</div>
              <p className="text-xs text-slate-600">Acumulados {d.vac.accrued} · disfrutados {d.vac.taken} · ajustes {d.vac.adjusted} · solicitados pendientes {d.vac.pendingRequested}</p>
              {d.vac.estimate && <Badge tone="yellow" className="mt-2">Estimación: reglas sin validar</Badge>}
            </Card>
          )}
        </div>
      </div>

      {d.write && (
        <Card title="Actualizar datos laborales" className="mt-4">
          <ActionForm action={updateEmployeeAction}>
            <input type="hidden" name="id" value={e.id} />
            <EmployeeFields value={e} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Estado laboral"><Select name="status" defaultValue={e.status}>{EMPLOYEE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
              <Field label="Fecha de terminación (si es baja)"><Input type="date" name="terminationDate" defaultValue={e.terminationDate ?? ""} /></Field>
              <Field label="Fecha efectiva del cambio"><Input type="date" name="effectiveDate" defaultValue={d.today} /></Field>
            </div>
            <SubmitButton>Guardar</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {d.salary && (
          <Card title="Salario">
            {e.currentSalary && (
              <p className="mb-3 text-sm">
                Salario mensual actual: <strong className="tabular">{formatMoney(e.currentSalary.salary, e.currentSalary.currency)}</strong>
                {e.payFrequency === "quincenal" && <> · cada quincena recibe <strong className="tabular">{formatMoney(e.currentSalary.salary / 2, e.currentSalary.currency)}</strong> (antes de deducciones)</>}
              </p>
            )}
            {e.salaryHistory?.length ? (
              <Table><thead><tr><Th>Desde</Th><Th>Salario</Th><Th>Motivo</Th></tr></thead><tbody>{e.salaryHistory.map((s) => <tr key={s.id}><Td>{formatDate(s.effectiveDate)}</Td><Td className="tabular">{formatMoney(s.salary, s.currency)}</Td><Td>{s.reason ?? "—"}</Td></tr>)}</tbody></Table>
            ) : <p className="text-sm text-slate-500">Sin registros.</p>}
            <ActionForm action={salaryAction} className="mt-3 border-t border-slate-100 pt-3">
              <input type="hidden" name="id" value={e.id} />
              <p className="mb-2 text-sm font-medium">Cambiar salario (aumento o rebaja)</p>
              <p className="mb-2 text-xs text-slate-500">El salario anterior queda en el historial. La nómina usa el nuevo desde la fecha efectiva; si el cambio cae a mitad de quincena, se calcula por partes.</p>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Nuevo salario mensual"><Input name="salary" required inputMode="decimal" /></Field>
                <Field label="Moneda"><Select name="currency"><option value="NIO">C$</option><option value="USD">US$</option></Select></Field>
                <Field label="Fecha efectiva"><Input type="date" name="effectiveDate" required defaultValue={d.today} /></Field>
              </div>
              <Field label="Motivo"><Input name="reason" placeholder="Ej.: aumento por desempeño" /></Field>
              <SubmitButton size="sm">Guardar nuevo salario</SubmitButton>
            </ActionForm>
          </Card>
        )}
        <Card title="Historial laboral (cargo, jornada, estado)">
          {e.changes.length ? (
            <Table><thead><tr><Th>Efectivo</Th><Th>Campo</Th><Th>Antes</Th><Th>Después</Th></tr></thead><tbody>{e.changes.map((c) => <tr key={c.id}><Td>{formatDate(c.effectiveDate)}</Td><Td>{c.field}</Td><Td>{c.oldValue ?? "—"}</Td><Td>{c.newValue ?? "—"}</Td></tr>)}</tbody></Table>
          ) : <p className="text-sm text-slate-500">Sin cambios registrados.</p>}
        </Card>
        {d.vac && (
          <Card title="Solicitudes y ajustes de vacaciones">
            <Table><thead><tr><Th>Período</Th><Th>Días</Th><Th>Estado</Th><Th></Th></tr></thead>
              <tbody>{d.vac.requests.map((r) => (
                <tr key={r.id}><Td>{formatDate(r.startDate)} – {formatDate(r.endDate)}</Td><Td>{r.days}</Td><Td><StatusBadge list={VACATION_STATUSES} value={r.status} /></Td>
                  <Td>{d.leaveApprove && r.status === "solicitada" && (
                    <div className="flex gap-1">
                      {(["aprobada", "rechazada"] as const).map((dec) => <ActionForm key={dec} action={vacationDecisionAction} inline><input type="hidden" name="id" value={r.id} /><input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="decision" value={dec} /><SubmitButton size="sm" variant={dec === "aprobada" ? "primary" : "secondary"}>{dec === "aprobada" ? "Aprobar" : "Rechazar"}</SubmitButton></ActionForm>)}
                    </div>
                  )}</Td></tr>
              ))}</tbody>
            </Table>
            {d.vac.adjustments.map((a) => <div key={a.id} className="mt-1 text-xs text-slate-600">Ajuste {a.days > 0 ? "+" : ""}{a.days} días · {a.reason} · {formatDateTime(a.createdAt)}</div>)}
            {d.leaveWrite && (
              <ActionForm action={vacationRequestAction} className="mt-3 border-t border-slate-100 pt-3" resetOnSuccess>
                <input type="hidden" name="employeeId" value={e.id} />
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Desde"><Input type="date" name="startDate" required /></Field>
                  <Field label="Hasta"><Input type="date" name="endDate" required /></Field>
                  <Field label="Días"><Input name="days" required inputMode="decimal" /></Field>
                </div>
                <SubmitButton size="sm" variant="secondary">Registrar solicitud</SubmitButton>
              </ActionForm>
            )}
            {d.leaveApprove && (
              <ActionForm action={leaveAdjustmentAction} inline className="mt-3">
                <input type="hidden" name="employeeId" value={e.id} />
                <Input name="days" placeholder="± días" className="w-24" required />
                <Input name="reason" placeholder="Motivo del ajuste" className="w-56" required />
                <SubmitButton size="sm" variant="ghost">Ajuste autorizado</SubmitButton>
              </ActionForm>
            )}
          </Card>
        )}
        {d.roles && !e.user && (
          <Card title="Dar acceso al sistema">
            <ActionForm action={createUserForEmployeeAction}>
              <input type="hidden" name="employeeId" value={e.id} /><input type="hidden" name="name" value={e.fullName} />
              <Field label="Correo de acceso"><Input type="email" name="email" required defaultValue={e.email ?? ""} /></Field>
              <Field label="Contraseña inicial" hint="Mínimo 8 caracteres"><Input type="password" name="password" required minLength={8} /></Field>
              <fieldset className="grid grid-cols-2 gap-1 text-sm">{d.roles.map((r) => <label key={r.id} className="flex items-center gap-1.5"><input type="checkbox" name="roleKeys[]" value={r.key} className="size-4" />{r.name}</label>)}</fieldset>
              <SubmitButton size="sm">Crear usuario</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

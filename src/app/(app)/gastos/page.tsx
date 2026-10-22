import { load, sp, type SP } from "../_lib/page";
import { can } from "@/server/ctx";
import { expensesSummary, getExpense, listCategories, listExpenses, listRecurringExpenses } from "@/server/services/expenses";
import { Badge, Card, Empty, Field, Input, PageHeader, Progress, Select, Stat, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EXPENSE_STATUSES, PAYMENT_METHODS, labelOf } from "@/lib/domain";
import { formatDate, formatPeriod } from "@/lib/dates";
import { formatMoney, formatPercent } from "@/lib/money";
import { budgetAction, createExpenseAction, createRecurringAction, payExpenseAction, recurringStatusAction, voidExpenseAction } from "./actions";

export const metadata = { title: "Gastos del mes" };

export default async function ExpensesPage({ searchParams }: { searchParams: SP }) {
  const q = await searchParams;
  const tab = sp(q.tab) ?? "mes";
  const d = await load(["expenses.read"], async (ctx) => {
    const month = sp(q.mes) ?? ctx.today.slice(0, 7);
    return {
      month,
      summary: await expensesSummary(ctx, `${month}-01`),
      rows: await listExpenses(ctx, { period: `${month}-01`, category: sp(q.categoria), supplier: sp(q.proveedor), status: sp(q.estado), currency: sp(q.moneda) }),
      recurring: tab === "recurrentes" ? await listRecurringExpenses(ctx) : [],
      categories: await listCategories(ctx),
      selected: sp(q.gasto) ? await getExpense(ctx, sp(q.gasto)!) : null,
      write: can(ctx, "expenses.write"),
      pay: can(ctx, "expenses.pay"),
      today: ctx.today,
    };
  });
  const s = d.summary;
  const base = s.base;
  const link = (patch: Record<string, string>) => `/gastos?${new URLSearchParams({ mes: d.month, tab, ...patch })}`;
  return (
    <>
      <PageHeader title="Gastos del mes" subtitle={`${formatPeriod(d.month + "-01")} · totales en ${base} (tipo de cambio ${s.rate})`} actions={<form><input type="hidden" name="tab" value={tab} /><Input type="month" name="mes" defaultValue={d.month} className="w-44" /></form>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Gastos del mes" value={formatMoney(s.totalBase, base)} hint={s.changeVsPrevious === null ? "Sin mes anterior" : `${s.changeVsPrevious >= 0 ? "▲" : "▼"} ${formatPercent(Math.abs(s.changeVsPrevious))} vs. mes anterior`} />
        <Stat label="Pagados" value={formatMoney(s.paidBase, base)} tone="green" />
        <Stat label="Pendientes" value={formatMoney(s.pendingBase, base)} tone={s.pendingBase ? "yellow" : undefined} />
        <Stat label="Vencidos" value={formatMoney(s.overdueBase, base)} tone={s.overdueBase ? "red" : undefined} />
        <Stat label="Salidas de caja del mes" value={formatMoney(s.cashOutBase, base)} hint="Pagos realizados en el mes" />
        <Stat label="Recurrencias activas" value={s.recurringCount} />
      </div>
      <Tabs active={tab} tabs={[{ key: "mes", label: "Gastos", href: link({ tab: "mes" }) }, { key: "categorias", label: "Por categoría y presupuesto", href: link({ tab: "categorias" }) }, { key: "recurrentes", label: "Recurrentes", href: link({ tab: "recurrentes" }) }]} />

      {tab === "mes" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <Card padded={false}>
            <form className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
              <input type="hidden" name="mes" value={d.month} />
              <Select name="categoria" defaultValue={sp(q.categoria) ?? ""} className="max-w-52"><option value="">Todas las categorías</option>{d.categories.map((c) => <option key={c.id} value={c.key}>{c.name}</option>)}</Select>
              <Input name="proveedor" placeholder="Proveedor" defaultValue={sp(q.proveedor)} className="w-40" />
              <Select name="estado" defaultValue={sp(q.estado) ?? ""} className="max-w-40"><option value="">Todos</option>{EXPENSE_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>
              <Select name="moneda" defaultValue={sp(q.moneda) ?? ""} className="w-28"><option value="">Moneda</option><option value="NIO">NIO</option><option value="USD">USD</option></Select>
              <button className="h-9 rounded-md border px-3 text-sm">Filtrar</button>
            </form>
            {d.rows.length ? (
              <Table>
                <thead><tr><Th>Gasto</Th><Th>Categoría</Th><Th>Vence</Th><Th>Importe</Th><Th>Saldo</Th><Th>Estado</Th></tr></thead>
                <tbody>{d.rows.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <Td><a href={link({ gasto: e.id })} className="font-medium hover:underline">{e.name}</a><div className="text-xs text-slate-500">{[e.supplier, e.clientName, e.sourceType !== "manual" ? e.sourceType : null].filter(Boolean).join(" · ")}</div></Td>
                    <Td>{e.categoryName}</Td><Td>{formatDate(e.dueDate)}</Td>
                    <Td className="tabular">{formatMoney(e.amount, e.currency)}</Td><Td className="tabular">{formatMoney(e.balance, e.currency)}</Td>
                    <Td><StatusBadge list={EXPENSE_STATUSES} value={e.status} /></Td>
                  </tr>
                ))}</tbody>
              </Table>
            ) : <div className="p-4"><Empty>No hay gastos en este mes.</Empty></div>}
          </Card>
          <div className="space-y-4">
            {d.selected && (
              <Card title={d.selected.name} actions={<a href={link({})} className="text-xs">Cerrar</a>}>
                <div className="space-y-1 text-sm">
                  <div>{d.selected.categoryName} · {d.selected.supplier ?? "sin proveedor"}</div>
                  <div>Importe {formatMoney(d.selected.amount, d.selected.currency)} · pagado {formatMoney(d.selected.paidAmount, d.selected.currency)} · <strong>saldo {formatMoney(d.selected.balance, d.selected.currency)}</strong></div>
                  <div>Registrado {formatDate(d.selected.registeredAt)} · vence {formatDate(d.selected.dueDate)} · contable {formatDate(d.selected.accountingDate)}</div>
                  <StatusBadge list={EXPENSE_STATUSES} value={d.selected.status} />
                </div>
                <h3 className="mt-3 text-xs font-semibold uppercase text-slate-500">Pagos</h3>
                {d.selected.payments.length ? d.selected.payments.map((p) => <div key={p.id} className="text-sm">{formatDate(p.paidAt)} · {formatMoney(p.amount, d.selected!.currency)} · {labelOf(PAYMENT_METHODS, p.method)}{p.reference && ` · ${p.reference}`}</div>) : <p className="text-sm text-slate-500">Sin pagos.</p>}
                {d.pay && d.selected.balance > 0 && (
                  <ActionForm action={payExpenseAction} className="mt-3 border-t border-slate-100 pt-3">
                    <input type="hidden" name="id" value={d.selected.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Importe" hint="Vacío = saldo completo"><Input name="amount" inputMode="decimal" /></Field>
                      <Field label="Fecha"><Input type="date" name="paidAt" required defaultValue={d.today} /></Field>
                      <Field label="Método"><Select name="method">{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
                      <Field label="Referencia / comprobante"><Input name="reference" /></Field>
                    </div>
                    <SubmitButton size="sm">Registrar pago</SubmitButton>
                  </ActionForm>
                )}
                {d.write && d.selected.paidAmount === 0 && d.selected.status !== "anulado" && d.selected.sourceType !== "nomina" && (
                  <ActionForm action={voidExpenseAction} inline className="mt-3"><input type="hidden" name="id" value={d.selected.id} /><Input name="reason" placeholder="Motivo" required className="w-48" /><SubmitButton size="sm" variant="ghost">Anular</SubmitButton></ActionForm>
                )}
              </Card>
            )}
            {d.write && (
              <Card title="Registrar gasto">
                <ActionForm action={createExpenseAction} resetOnSuccess>
                  <Field label="Concepto *"><Input name="name" required /></Field>
                  <Field label="Categoría *"><Select name="category" required>{d.categories.map((c) => <option key={c.id} value={c.key}>{c.name}</option>)}</Select></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Importe *"><Input name="amount" required inputMode="decimal" /></Field>
                    <Field label="Moneda"><Select name="currency"><option value="NIO">C$</option><option value="USD">US$</option></Select></Field>
                    <Field label="Vencimiento"><Input type="date" name="dueDate" /></Field>
                    <Field label="Fecha contable"><Input type="date" name="accountingDate" defaultValue={d.today} /></Field>
                  </div>
                  <Field label="Proveedor"><Input name="supplier" /></Field>
                  <Field label="Departamento"><Input name="department" /></Field>
                  <Field label="Observaciones"><Input name="notes" /></Field>
                  <SubmitButton className="w-full">Registrar (queda pendiente de pago)</SubmitButton>
                </ActionForm>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "categorias" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Gastos por categoría">
            {s.byCategory.length ? s.byCategory.map((c) => (
              <div key={c.name} className="mb-2 text-sm"><div className="flex justify-between"><span>{c.name}</span><span className="tabular">{formatMoney(c.amount, base)}</span></div><Progress value={s.totalBase ? c.amount / s.totalBase : 0} /></div>
            )) : <Empty>Sin gastos.</Empty>}
          </Card>
          <Card title="Presupuesto vs. gasto real">
            {s.budget.length ? (
              <Table><thead><tr><Th>Categoría</Th><Th>Presupuesto</Th><Th>Real</Th><Th>Uso</Th></tr></thead>
                <tbody>{s.budget.map((b) => <tr key={b.category}><Td>{b.category}</Td><Td className="tabular">{formatMoney(b.budget, base)}</Td><Td className="tabular">{formatMoney(b.actual, base)}</Td><Td><Badge tone={b.actual > b.budget ? "red" : "green"}>{formatPercent(b.budget ? b.actual / b.budget : 0)}</Badge></Td></tr>)}</tbody>
              </Table>
            ) : <Empty>No hay presupuestos para este mes.</Empty>}
            {d.write && (
              <ActionForm action={budgetAction} inline className="mt-3">
                <input type="hidden" name="month" value={d.month} />
                <Select name="category" className="w-52">{d.categories.map((c) => <option key={c.id} value={c.key}>{c.name}</option>)}</Select>
                <Input name="amount" placeholder="Monto" className="w-28" required />
                <Select name="currency" className="w-24"><option value="NIO">C$</option><option value="USD">US$</option></Select>
                <SubmitButton size="sm" variant="secondary">Guardar</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title="Próximos vencimientos (15 días)" className="lg:col-span-2">
            {s.upcoming.length ? s.upcoming.map((u) => <div key={u.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span>{u.name}</span><span>{formatDate(u.dueDate)} · {formatMoney(u.balance, u.currency)}</span></div>) : <Empty>Nada por vencer.</Empty>}
          </Card>
        </div>
      )}

      {tab === "recurrentes" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <Card padded={false}>
            {d.recurring.length ? (
              <Table><thead><tr><Th>Gasto</Th><Th>Categoría</Th><Th>Importe</Th><Th>Frecuencia</Th><Th>Desde</Th><Th>Estado</Th><Th></Th></tr></thead>
                <tbody>{d.recurring.map(({ r, categoryName }) => (
                  <tr key={r.id}><Td className="font-medium">{r.name}<div className="text-xs text-slate-500">{r.supplier}</div></Td><Td>{categoryName}</Td><Td className="tabular">{formatMoney(r.amount, r.currency)}</Td><Td>Día {r.dayOfMonth}, cada {r.intervalMonths} mes(es)</Td><Td>{formatDate(r.startDate)}</Td><Td><Badge tone={r.status === "activa" ? "green" : r.status === "pausada" ? "yellow" : "gray"}>{r.status}</Badge></Td>
                    <Td>{d.write && r.status !== "cancelada" && (
                      <div className="flex gap-1">
                        <ActionForm action={recurringStatusAction} inline><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={r.status === "activa" ? "pausada" : "activa"} /><SubmitButton size="sm" variant="secondary">{r.status === "activa" ? "Pausar" : "Reanudar"}</SubmitButton></ActionForm>
                        <ActionForm action={recurringStatusAction} inline><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="cancelada" /><SubmitButton size="sm" variant="ghost">Cancelar</SubmitButton></ActionForm>
                      </div>
                    )}</Td></tr>
                ))}</tbody>
              </Table>
            ) : <div className="p-4"><Empty>No hay gastos recurrentes.</Empty></div>}
          </Card>
          {d.write && (
            <Card title="Nuevo gasto recurrente">
              <ActionForm action={createRecurringAction} resetOnSuccess>
                <Field label="Concepto *"><Input name="name" required placeholder="Alquiler del local" /></Field>
                <Field label="Categoría"><Select name="category">{d.categories.map((c) => <option key={c.id} value={c.key}>{c.name}</option>)}</Select></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Importe *"><Input name="amount" required /></Field>
                  <Field label="Moneda"><Select name="currency"><option value="NIO">C$</option><option value="USD">US$</option></Select></Field>
                  <Field label="Día del mes"><Input type="number" name="dayOfMonth" min={1} max={28} defaultValue={5} /></Field>
                  <Field label="Cada (meses)"><Input type="number" name="intervalMonths" min={1} max={12} defaultValue={1} /></Field>
                  <Field label="Inicio *"><Input type="date" name="startDate" required defaultValue={d.today} /></Field>
                  <Field label="Fin"><Input type="date" name="endDate" /></Field>
                </div>
                <Field label="Proveedor"><Input name="supplier" /></Field>
                <SubmitButton className="w-full">Crear recurrencia</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

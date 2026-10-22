"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/expenses";

export async function createExpenseAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createExpense(ctx, o, { allowDuplicate: isConfirmed(o), confirmPayrollManual: isConfirmed(o) }), { revalidate: ["/gastos"], duplicateConfirm: true, success: (e) => `Gasto registrado: ${e.name}` });
}
export async function payExpenseAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Registrar un pago es irreversible (solo se corrige con un ajuste). ¿Confirmas?", at: Date.now() };
  return run((ctx) => svc.recordExpensePayment(ctx, String(o.id), { ...o, amount: o.amount === "" ? undefined : o.amount }), { revalidate: ["/gastos"], success: (r) => `Pago registrado. Estado: ${r.expense.status}` });
}
export async function voidExpenseAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.voidExpense(ctx, String(o.id), String(o.reason ?? "")), { revalidate: ["/gastos"], success: "Gasto anulado" });
}
export async function createRecurringAction(_: ActionState, fd: FormData) {
  return run((ctx) => svc.createRecurringExpense(ctx, formToObject(fd)), { revalidate: ["/gastos"], success: (r) => `Recurrencia creada. ${r.generated} período(s) generado(s) como pendientes.` });
}
export async function recurringStatusAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.setRecurringStatus(ctx, String(o.id), o.status as "activa"), { revalidate: ["/gastos"], success: (r) => `Recurrencia ${r.recurring.status}${r.voided ? ` (${r.voided} gasto(s) futuro(s) anulado(s))` : ""}` });
}
export async function budgetAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.setBudget(ctx, { category: String(o.category), period: `${o.month}-01`, amount: Number(o.amount), currency: String(o.currency ?? "NIO") }), { revalidate: ["/gastos"], success: "Presupuesto guardado" });
}

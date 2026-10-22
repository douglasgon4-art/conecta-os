"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/payroll";

export async function preparePayrollAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const [periodStart, periodEnd] = String(o.period).split("|");
  return run((ctx) => svc.preparePayroll(ctx, { periodStart, periodEnd }), { revalidate: ["/nomina"], redirectTo: (r) => `/nomina/${r.period.id}` });
}
export async function recalcPayrollAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.preparePayroll(ctx, { periodStart: String(o.periodStart), periodEnd: String(o.periodEnd) }), { revalidate: [`/nomina/${o.id}`], success: (r) => `Recalculada: ${r.count} colaborador(es)${r.skipped.length ? `; omitidos: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}` : ""}` });
}
export async function adjustmentAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.addPayrollAdjustment(ctx, String(o.id), { employeeId: String(o.employeeId), type: o.type as "percepcion", concept: String(o.concept), amount: Number(o.amount) }), { revalidate: [`/nomina/${o.id}`], success: "Ajuste autorizado y nómina recalculada" });
}
export async function approvePayrollAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.approvePayroll(ctx, String(o.id), { confirm: isConfirmed(o) }), { revalidate: [`/nomina/${o.id}`, "/nomina"], success: "Nómina aprobada" });
}
export async function postPayrollAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Se generarán los gastos y obligaciones por pagar de esta nómina (una sola vez). ¿Contabilizar?", at: Date.now() };
  return run((ctx) => svc.postPayroll(ctx, String(o.id)), { revalidate: [`/nomina/${o.id}`, "/nomina", "/gastos"], success: (r) => `Contabilizada: ${r.expenses.length} obligación(es) generada(s)` });
}
export async function payPayrollAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.markPayrollPaid(ctx, String(o.id), { paidAt: String(o.paidAt), method: o.method as "transferencia" }, { confirm: isConfirmed(o) }), { revalidate: [`/nomina/${o.id}`, "/nomina", "/gastos"], success: "Pago de salarios registrado" });
}

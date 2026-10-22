"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/employees";
import * as payroll from "@/server/services/payroll";
import { createUser } from "@/server/services/users";

export async function createEmployeeAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createEmployee(ctx, o, { allowDuplicate: isConfirmed(o) }), { revalidate: ["/colaboradores"], duplicateConfirm: true, redirectTo: (e) => `/colaboradores/${e.id}` });
}
export async function updateEmployeeAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const id = String(o.id);
  delete o.id;
  return run((ctx) => svc.updateEmployee(ctx, id, o), { revalidate: [`/colaboradores/${id}`, "/colaboradores"], success: "Datos laborales actualizados (con historial)" });
}
export async function salaryAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.changeSalary(ctx, String(o.id), o, { confirmRetroactive: isConfirmed(o) }), { revalidate: [`/colaboradores/${o.id}`], success: "Cambio salarial registrado" });
}
export async function vacationRequestAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => payroll.requestVacation(ctx, { employeeId: String(o.employeeId), startDate: String(o.startDate), endDate: String(o.endDate), days: Number(o.days), reason: o.reason as string }), {
    revalidate: [`/colaboradores/${o.employeeId}`],
    success: (r) => (r.exceedsBalance ? `Solicitud registrada. Atención: supera el saldo disponible (${r.balance} días).` : "Solicitud registrada"),
  });
}
export async function vacationDecisionAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => payroll.decideVacation(ctx, String(o.id), o.decision as "aprobada"), { revalidate: [`/colaboradores/${o.employeeId}`], success: "Solicitud resuelta" });
}
export async function leaveAdjustmentAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => payroll.addLeaveAdjustment(ctx, { employeeId: String(o.employeeId), days: Number(o.days), reason: String(o.reason) }), { revalidate: [`/colaboradores/${o.employeeId}`], success: "Ajuste registrado" });
}
export async function createUserForEmployeeAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (!isConfirmed(o)) return { ok: false, confirm: "Crear un usuario otorga acceso al sistema con los permisos del rol elegido. ¿Confirmas?", at: Date.now() };
  return run((ctx) => createUser(ctx, { email: o.email, name: o.name, password: o.password, roleKeys: ([] as unknown[]).concat(o.roleKeys ?? []) as string[], employeeId: o.employeeId }), { revalidate: [`/colaboradores/${o.employeeId}`], success: "Usuario creado" });
}

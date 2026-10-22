"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/sessions";

export async function updateSessionAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.updateSession(ctx, String(o.id), o), { revalidate: ["/agenda"], success: "Sesión actualizada" });
}
export async function completeSessionAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.completeSession(ctx, String(o.id), { completedDate: String(o.completedDate), notes: o.notes as string }), {
    revalidate: ["/agenda"],
    success: (r) => `Sesión registrada como realizada.${r.next ? ` Próxima prevista: ${r.next.expectedDate}.` : ""}${r.materialMarked ? ` ${r.materialMarked} reel(s) con material recibido.` : ""}`,
  });
}
export async function cancelSessionAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.cancelSession(ctx, String(o.id), String(o.reason ?? ""), { confirm: isConfirmed(o) }), { revalidate: ["/agenda"], success: "Sesión cancelada (queda en el historial)" });
}
export async function scheduleSessionAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.scheduleSession(ctx, { ...o, confirmed: o.confirmed === "on" }), { revalidate: ["/agenda"], success: (r) => (r.created ? "Sesión programada" : "Se actualizó la sesión abierta del cliente (sin duplicar)") });
}

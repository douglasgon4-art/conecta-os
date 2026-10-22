"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/strategy";
import type { PlanStatus } from "@/lib/domain";

export async function updatePlanAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const id = String(o.id);
  delete o.id;
  return run((ctx) => svc.updatePlan(ctx, id, o), { revalidate: [`/estrategia/${id}`], success: "Planificación guardada" });
}
export async function updateItemAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const id = String(o.itemId);
  delete o.itemId;
  delete o.planId;
  return run((ctx) => svc.updatePlanItem(ctx, id, o), { revalidate: [`/estrategia/${fd.get("planId")}`], success: "Guardado" });
}
export async function setPlanStatusAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.setPlanStatus(ctx, String(o.id), o.status as PlanStatus, o.note as string), {
    revalidate: [`/estrategia/${o.id}`, "/estrategia"],
    success: (r) => (r.sync ? `Planificación aprobada: ${r.sync.linked} elementos enviados a producción` : "Estado actualizado"),
  });
}
export async function duplicatePlanAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.duplicatePlanFrom(ctx, String(o.id), String(o.sourceId), { confirm: isConfirmed(o) }), { revalidate: [`/estrategia/${o.id}`], success: "Contenido copiado como punto de partida" });
}
export async function createPlanAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createMonthlyPlan(ctx, String(o.clientId), `${o.month}-01`), { revalidate: ["/estrategia"], redirectTo: (r) => `/estrategia/${r.plan.id}` });
}

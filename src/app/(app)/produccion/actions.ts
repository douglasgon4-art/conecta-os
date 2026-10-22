"use server";
import { formToObject, isConfirmed, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/production";

export async function updateDeliverableAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const id = String(o.id);
  const boardId = String(o.boardId);
  delete o.id;
  delete o.boardId;
  return run((ctx) => svc.updateDeliverable(ctx, id, o), { revalidate: [`/produccion/${boardId}`, "/produccion"], success: (d) => `${d.title} actualizado` });
}
export async function completeDeliverableAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.completeDeliverable(ctx, String(o.id), (o.finalFileUrl as string) || undefined), { revalidate: [`/produccion/${o.boardId}`, "/produccion"], success: (d) => `${d.title}: terminado` });
}
export async function bulkCompleteAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.bulkCompleteDeliverables(ctx, String(o.boardId), o.group as "disenos" | "reels", { confirm: isConfirmed(o) }), {
    revalidate: [`/produccion/${o.boardId}`, "/produccion"],
    success: (r) => `Completados: ${r.completed.length}.${r.skippedMissingFile.length ? ` Sin archivo final (no se completaron): ${r.skippedMissingFile.join(", ")}.` : ""}`,
  });
}
export async function updateBoardAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const id = String(o.id);
  delete o.id;
  return run((ctx) => svc.updateBoard(ctx, id, o), { revalidate: [`/produccion/${id}`, "/produccion"], success: "Tablero actualizado" });
}
export async function addVariantAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.addPlatformVariant(ctx, String(o.boardId), o.kind as "perfil" | "portada", String(o.platform)), { revalidate: [`/produccion/${o.boardId}`], success: "Variante agregada (no cuenta como arte adicional)" });
}

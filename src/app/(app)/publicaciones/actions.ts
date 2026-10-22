"use server";
import { formToObject, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/publications";

export async function createPublicationAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.createPublication(ctx, o), { revalidate: ["/publicaciones"], success: "Publicación planificada" });
}
export async function updatePublicationAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  const id = String(o.id);
  delete o.id;
  return run((ctx) => svc.updatePublication(ctx, id, o), { revalidate: ["/publicaciones"], success: (p) => (p.status === "publicada" ? "Confirmada como publicada (queda registrado quién y cuándo)" : "Actualizada") });
}
export async function reschedulePublicationAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.reschedulePublication(ctx, String(o.id), { scheduledDate: String(o.scheduledDate), reason: o.reason as string }), { revalidate: ["/publicaciones"], success: "Reprogramada" });
}

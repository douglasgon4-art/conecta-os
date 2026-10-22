"use server";
import { formToObject, run, type ActionState } from "../_lib/action";
import { markRead } from "@/server/services/notifications";

export async function markReadAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => markRead(ctx, (o.id as string) || undefined), { revalidate: ["/notificaciones"], success: "Marcadas como leídas" });
}

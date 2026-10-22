"use server";
import { formToObject, run, type ActionState } from "../_lib/action";
import { changeOwnPassword } from "@/server/services/users";

export async function passwordAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  if (o.next !== o.confirm) return { ok: false, error: "Las contraseñas no coinciden", at: Date.now() };
  return run((ctx) => changeOwnPassword(ctx, String(o.current), String(o.next)), { revalidate: ["/perfil"], success: "Contraseña actualizada" });
}

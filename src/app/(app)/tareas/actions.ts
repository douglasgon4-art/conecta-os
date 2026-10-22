"use server";
import { formToObject, run, type ActionState } from "../_lib/action";
import * as svc from "@/server/services/tasks";

export async function createTaskAction(_: ActionState, fd: FormData) {
  return run((ctx) => svc.createTask(ctx, formToObject(fd)), { revalidate: ["/tareas"], success: "Tarea creada" });
}
export async function taskStatusAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.setTaskStatus(ctx, String(o.id), String(o.status), o.reason as string), { revalidate: ["/tareas", "/"], success: "Tarea actualizada" });
}
export async function assignTaskAction(_: ActionState, fd: FormData) {
  const o = formToObject(fd);
  return run((ctx) => svc.assignTasks(ctx, [String(o.id)], (o.assigneeId as string) || null), { revalidate: ["/tareas"], success: "Tarea asignada" });
}

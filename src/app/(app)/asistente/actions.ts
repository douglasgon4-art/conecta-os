"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "@/server/auth/session";
import { resolvePendingAction, runAgentTurn, type AgentTurnResult } from "@/server/agent/runner";
import { AppError } from "@/server/errors";

export async function sendToAgent(conversationId: string | null, message: string): Promise<AgentTurnResult | { status: "error"; message: string }> {
  const actor = await getActor();
  if (!actor) return { status: "error", message: "Sesión expirada" };
  if (!message.trim()) return { status: "error", message: "Escribe una instrucción" };
  try {
    const r = await runAgentTurn(actor, { conversationId: conversationId ?? undefined, message: message.slice(0, 4000) });
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    console.error(e);
    return { status: "error", message: e instanceof AppError ? e.message : "El asistente no pudo completar la solicitud. No se confirmó ninguna acción." };
  }
}

export async function decideAction(actionId: string, decision: "confirmar" | "rechazar") {
  const actor = await getActor();
  if (!actor) return { status: "error" as const, summary: "Sesión expirada" };
  try {
    const r = await resolvePendingAction(actor, actionId, decision);
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { status: "error" as const, summary: e instanceof AppError ? e.message : "No se pudo resolver la acción" };
  }
}

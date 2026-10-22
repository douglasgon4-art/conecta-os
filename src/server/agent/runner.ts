import { and, asc, desc, eq } from "drizzle-orm";
import { aiActionLogs, aiConversations, aiMessages } from "../db/schema";
import { audit, requirePerm, withCtx, type Actor, type Ctx } from "../ctx";
import { AppError } from "../errors";
import { formatDate } from "@/lib/dates";
import { getAgentProvider, type AgentMessage } from "./provider";
import { isSensitive, toolsFor, TOOLS, type ToolDef } from "./tools";

const MAX_ITERATIONS = 10;

export type PendingAction = { id: string; tool: string; summary: string; input: unknown };
export type AgentTurnResult =
  | { status: "not_configured"; message: string }
  | { status: "ok" | "refused" | "incomplete"; conversationId: string; reply: string; actions: { id: string; tool: string; status: string; summary: string }[]; pending: PendingAction[] };

function systemPrompt(actor: Actor, today: string, tools: ToolDef[]) {
  return [
    "Eres el Asistente de CONECTA OS, el sistema operativo interno de la agencia de marketing digital CONECTA (Nicaragua).",
    "Ejecutas acciones reales en la aplicación usando exclusivamente las herramientas disponibles. Respondes siempre en español, de forma breve y clara.",
    `Hoy es ${formatDate(today, { withWeekday: true })} (${today}), zona horaria America/Managua. Usuario: ${actor.name}. Roles: ${actor.roles.join(", ") || "—"}.`,
    "Reglas:",
    "- Antes de crear algo, busca si ya existe (clientes, colaboradores, prospectos, gastos) para no duplicar. Si hay un posible duplicado, pregunta al usuario.",
    "- Si falta un dato obligatorio para una herramienta, pregúntalo. Nunca inventes datos personales, montos ni fechas que el usuario no haya dado.",
    "- 'córdobas' = NIO, 'dólares' = USD. Convierte fechas relativas (mañana, el lunes) a AAAA-MM-DD usando la fecha de hoy.",
    "- Solo afirma que algo se hizo si la herramienta devolvió éxito. Si devolvió error, explica el error con tus palabras y no digas que se completó.",
    "- Algunas acciones sensibles (archivar, registrar pagos, cambiar salarios, convertir ventas, acciones masivas) quedan PENDIENTES DE CONFIRMACIÓN: el usuario debe pulsar «Confirmar» en la interfaz. En ese caso di que está pendiente de su confirmación; nunca digas que ya se ejecutó.",
    "- Si el usuario pide algo para lo que no tienes herramienta o permiso, dilo claramente.",
    `Herramientas permitidas para este usuario: ${tools.map((t) => t.name).join(", ")}.`,
  ].join("\n");
}

async function loadHistory(ctx: Ctx, conversationId: string): Promise<AgentMessage[]> {
  const rows = await ctx.tx.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(asc(aiMessages.createdAt));
  return rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content }) as AgentMessage);
}

async function appendMessage(ctx: Ctx, conversationId: string, role: "user" | "assistant", content: unknown, display?: string | null) {
  await ctx.tx.insert(aiMessages).values({ conversationId, role, content: content as never, display: display ?? null });
}

function errorText(e: unknown) {
  if (e instanceof AppError) return e.message + (e.details?.candidates ? ` Coincidencias: ${JSON.stringify(e.details.candidates)}` : "");
  return "Error interno al ejecutar la acción.";
}

/** Ejecuta una herramienta dentro de su propia transacción (savepoint) para que un fallo no deshaga el resto. */
async function executeTool(ctx: Ctx, tool: ToolDef, input: Record<string, unknown>, confirmed: boolean) {
  return ctx.tx.transaction(async (sp) => tool.run(Object.create(ctx, { tx: { value: sp } }) as Ctx, input, { confirmed }));
}

/**
 * Un turno del agente: interpreta la instrucción, llama herramientas reales (con permisos y validaciones del backend),
 * deja las acciones sensibles pendientes de confirmación y registra todo en auditoría.
 */
export async function runAgentTurn(actor: Actor, input: { conversationId?: string; message: string }, opts: { now?: Date } = {}): Promise<AgentTurnResult> {
  const provider = getAgentProvider();
  if (!provider) {
    return { status: "not_configured", message: "El Asistente de CONECTA está pendiente de configuración: falta definir el proveedor de IA (ANTHROPIC_API_KEY) en el servidor. No se ejecutó ninguna acción." };
  }
  const agentActor: Actor = { ...actor, source: "agent" };
  // Paso 1: registrar la instrucción (transacción corta).
  const conversationId = await withCtx(agentActor, async (ctx) => {
    requirePerm(ctx, "agent.use");
    let id = input.conversationId;
    if (id) {
      const [c] = await ctx.tx.select().from(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.userId, actor.userId!)));
      if (!c) throw new AppError("NOT_FOUND", "Conversación no encontrada");
      await ctx.tx.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, id));
    } else {
      [{ id }] = await ctx.tx.insert(aiConversations).values({ userId: actor.userId!, title: input.message.slice(0, 80) }).returning({ id: aiConversations.id });
    }
    await appendMessage(ctx, id!, "user", [{ type: "text", text: input.message }], input.message);
    return id!;
  }, opts);

  const actions: { id: string; tool: string; status: string; summary: string }[] = [];
  const pending: PendingAction[] = [];
  let reply = "";
  let status: "ok" | "refused" | "incomplete" = "incomplete";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const { messages, tools, system } = await withCtx(agentActor, async (ctx) => {
      const tools = toolsFor(ctx);
      return { messages: await loadHistory(ctx, conversationId), tools, system: systemPrompt(actor, ctx.today, tools) };
    }, opts);
    const response = await provider.complete({
      system,
      messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    });
    // El contenido se guarda completo e inalterado (incluidos bloques de razonamiento) y solo se agrega.
    await withCtx(agentActor, (ctx) => appendMessage(ctx, conversationId, "assistant", response.content, response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n")), opts);
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    if (text) reply = text;

    if (response.stopReason === "refusal") {
      reply = "No puedo procesar esa solicitud.";
      status = "refused";
      break;
    }
    if (response.stopReason === "pause_turn") continue;
    const uses = response.content.filter((b) => b.type === "tool_use") as { type: "tool_use"; id: string; name: string; input: unknown }[];
    if (response.stopReason !== "tool_use" || !uses.length) {
      status = response.stopReason === "max_tokens" ? "incomplete" : "ok";
      break;
    }

    // Ejecutar todas las herramientas pedidas y devolver todos los resultados en un único mensaje.
    const results = await withCtx(agentActor, async (ctx) => {
      const allowed = toolsFor(ctx);
      const out: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
      for (const use of uses) {
        const toolInput = (use.input && typeof use.input === "object" ? use.input : {}) as Record<string, unknown>;
        const tool = allowed.find((t) => t.name === use.name);
        const base = { userId: actor.userId!, conversationId, instruction: input.message, toolName: use.name, toolInput: toolInput as never };
        if (!tool) {
          const exists = TOOLS.some((t) => t.name === use.name);
          const msg = exists ? "No tienes permiso para esta acción." : `Herramienta desconocida: ${use.name}`;
          await ctx.tx.insert(aiActionLogs).values({ ...base, status: "denegada", error: msg, finishedAt: new Date() });
          actions.push({ id: use.id, tool: use.name, status: "denegada", summary: msg });
          out.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
          continue;
        }
        if (isSensitive(tool, toolInput)) {
          const [log] = await ctx.tx.insert(aiActionLogs).values({ ...base, status: "pendiente_confirmacion", requiresConfirmation: true }).returning();
          const summary = describeAction(tool, toolInput);
          pending.push({ id: log.id, tool: tool.name, summary, input: toolInput });
          out.push({ type: "tool_result", tool_use_id: use.id, content: `PENDIENTE DE CONFIRMACIÓN (acción ${log.id}): "${summary}". NO se ha ejecutado. Indica al usuario que debe confirmarla en la interfaz.` });
          continue;
        }
        try {
          const r = await executeTool(ctx, tool, toolInput, false);
          await ctx.tx.insert(aiActionLogs).values({ ...base, status: "ejecutada", result: { summary: r.summary, data: r.data ?? null } as never, affected: (r.affected ?? null) as never, finishedAt: new Date() });
          if (r.affected?.length) await audit(ctx, { action: `agent.${tool.name}`, entityType: r.affected[0].type, entityId: r.affected[0].id, summary: `Asistente: ${r.summary}`, after: { instruction: input.message, input: toolInput } });
          actions.push({ id: use.id, tool: tool.name, status: "ejecutada", summary: r.summary });
          out.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ ok: true, resultado: r.summary, datos: r.data ?? null }) });
        } catch (e) {
          if (e instanceof AppError && e.code === "CONFIRMATION_REQUIRED") {
            const [log] = await ctx.tx.insert(aiActionLogs).values({ ...base, status: "pendiente_confirmacion", requiresConfirmation: true, error: e.message }).returning();
            pending.push({ id: log.id, tool: tool.name, summary: e.message, input: toolInput });
            out.push({ type: "tool_result", tool_use_id: use.id, content: `PENDIENTE DE CONFIRMACIÓN (acción ${log.id}): ${e.message} NO se ha ejecutado.` });
            continue;
          }
          const msg = errorText(e);
          await ctx.tx.insert(aiActionLogs).values({ ...base, status: "fallida", error: msg, finishedAt: new Date() });
          actions.push({ id: use.id, tool: tool.name, status: "fallida", summary: msg });
          out.push({ type: "tool_result", tool_use_id: use.id, content: `ERROR: ${msg}`, is_error: true });
        }
      }
      await appendMessage(ctx, conversationId, "user", out, null);
      return out;
    }, opts);
    void results;
  }
  return { status, conversationId, reply: reply || "No obtuve una respuesta del asistente.", actions, pending };
}

function describeAction(tool: ToolDef, input: Record<string, unknown>) {
  const labels: Record<string, string> = {
    archive_client: "Archivar cliente",
    reactivate_client: "Reactivar cliente",
    change_salary: "Cambiar salario",
    record_expense_payment: "Registrar pago de gasto",
    record_invoice_payment: "Registrar cobro de factura",
    convert_lead: "Convertir venta ganada en cliente",
    bulk_complete_deliverables: "Completar entregables en grupo",
    update_employee: "Dar de baja a colaborador",
  };
  return `${labels[tool.name] ?? tool.name}: ${JSON.stringify(input)}`;
}

/** El usuario confirma (o rechaza) una acción sensible pendiente: se ejecuta exactamente lo propuesto. */
export async function resolvePendingAction(actor: Actor, actionId: string, decision: "confirmar" | "rechazar", opts: { now?: Date } = {}) {
  const agentActor: Actor = { ...actor, source: "agent" };
  return withCtx(agentActor, async (ctx) => {
    requirePerm(ctx, "agent.use");
    const [log] = await ctx.tx.select().from(aiActionLogs).where(and(eq(aiActionLogs.id, actionId), eq(aiActionLogs.userId, actor.userId!))).for("update");
    if (!log) throw new AppError("NOT_FOUND", "Acción no encontrada");
    if (log.status !== "pendiente_confirmacion") throw new AppError("CONFLICT", `La acción ya fue ${log.status}`);
    const note = async (text: string) => {
      if (log.conversationId) await appendMessage(ctx, log.conversationId, "user", [{ type: "text", text: `[Nota del sistema] ${text}` }], text);
    };
    if (decision === "rechazar") {
      await ctx.tx.update(aiActionLogs).set({ status: "rechazada", finishedAt: new Date() }).where(eq(aiActionLogs.id, actionId));
      await note(`El usuario rechazó la acción ${log.toolName}. No se ejecutó.`);
      return { status: "rechazada" as const, summary: "Acción rechazada. No se ejecutó nada." };
    }
    const tool = toolsFor(ctx).find((t) => t.name === log.toolName);
    if (!tool) {
      await ctx.tx.update(aiActionLogs).set({ status: "denegada", error: "Sin permiso", finishedAt: new Date() }).where(eq(aiActionLogs.id, actionId));
      throw new AppError("FORBIDDEN", "Ya no tienes permiso para esta acción");
    }
    try {
      const r = await executeTool(ctx, tool, log.toolInput as Record<string, unknown>, true);
      await ctx.tx.update(aiActionLogs).set({ status: "ejecutada", confirmedAt: new Date(), result: { summary: r.summary, data: r.data ?? null } as never, affected: (r.affected ?? null) as never, finishedAt: new Date() }).where(eq(aiActionLogs.id, actionId));
      await audit(ctx, { action: `agent.${tool.name}`, entityType: r.affected?.[0]?.type ?? "ai_action", entityId: r.affected?.[0]?.id ?? actionId, summary: `Asistente (confirmado por el usuario): ${r.summary}`, after: { instruction: log.instruction, input: log.toolInput } });
      await note(`El usuario confirmó la acción ${tool.name}. Resultado real: ${r.summary}`);
      return { status: "ejecutada" as const, summary: r.summary };
    } catch (e) {
      const msg = errorText(e);
      await ctx.tx.update(aiActionLogs).set({ status: "fallida", confirmedAt: new Date(), error: msg, finishedAt: new Date() }).where(eq(aiActionLogs.id, actionId));
      await note(`La acción confirmada ${tool.name} falló: ${msg}`);
      return { status: "fallida" as const, summary: msg };
    }
  }, opts);
}

export async function listConversations(actor: Actor) {
  return withCtx(actor, ({ tx }) => tx.select().from(aiConversations).where(eq(aiConversations.userId, actor.userId!)).orderBy(desc(aiConversations.updatedAt)).limit(30));
}

export async function getConversation(actor: Actor, id: string) {
  return withCtx(actor, async ({ tx }) => {
    const [c] = await tx.select().from(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.userId, actor.userId!)));
    if (!c) throw new AppError("NOT_FOUND", "Conversación no encontrada");
    const msgs = await tx.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(asc(aiMessages.createdAt));
    const logs = await tx.select().from(aiActionLogs).where(eq(aiActionLogs.conversationId, id)).orderBy(asc(aiActionLogs.createdAt));
    return { conversation: c, messages: msgs.filter((m) => m.display), actions: logs };
  });
}

export async function listAgentActions(ctx: Ctx, limit = 200) {
  requirePerm(ctx, "audit.read");
  return ctx.tx.select().from(aiActionLogs).orderBy(desc(aiActionLogs.createdAt)).limit(limit);
}

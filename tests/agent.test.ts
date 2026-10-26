import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { as, asSystem, at, makeUser, standardContract, uniq } from "./helpers";
import { setAgentProvider, type AgentProvider, type CompletionRequest } from "@/server/agent/provider";
import { resolvePendingAction, runAgentTurn as runRaw, type AgentTurnResult } from "@/server/agent/runner";

type Ok = Extract<AgentTurnResult, { status: "ok" | "refused" | "incomplete" }>;
const runAgentTurn = async (...a: Parameters<typeof runRaw>) => (await runRaw(...a)) as Ok;
import { aiActionLogs, employees, employeeSalaryHistory, expenses, leads, auditLogs } from "@/server/db/schema";
import { createClient } from "@/server/services/clients";
import { getBoardByClientPeriod } from "@/server/services/production";

type Step = (req: CompletionRequest) => { content: unknown[]; stopReason: string };

/** Proveedor determinista: cada paso decide la respuesta a partir de la petición (incluidos los tool_result previos). */
function scripted(steps: Step[]): AgentProvider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  let i = 0;
  return {
    name: "fake",
    requests,
    async complete(req) {
      requests.push(structuredClone(req));
      const step = steps[Math.min(i++, steps.length - 1)];
      const r = step(req);
      return { content: r.content as never, stopReason: r.stopReason, model: "fake" };
    },
  };
}
const toolUse = (name: string, input: object, id = "t" + Math.random().toString(36).slice(2, 8)) => ({ content: [{ type: "tool_use", id, name, input }], stopReason: "tool_use" });
const say = (text: string) => ({ content: [{ type: "text", text }], stopReason: "end_turn" });
const lastToolResult = (req: CompletionRequest) => {
  const m = req.messages.at(-1)!;
  const block = (m.content as { type: string; content?: string; is_error?: boolean }[])[0];
  return block;
};

afterEach(() => setAgentProvider(undefined));
const TODAY = at("2026-10-22");

describe("Asistente de CONECTA", () => {
  it("sin proveedor configurado no simula nada", async () => {
    setAgentProvider(null);
    const manager = await makeUser("gerencia");
    const r = await runAgentTurn(manager, { message: "Agrega un colaborador" });
    expect(r.status).toBe("not_configured");
  });

  it("crea un colaborador real, verifica el resultado y lo audita; detecta el duplicado después", async () => {
    const manager = await makeUser("gerencia");
    const name = uniq("Douglas González");
    const provider = scripted([
      () => toolUse("create_employee", { fullName: name, salary: 9000, currency: "NIO", startDate: "2026-10-21" }),
      (req) => say(lastToolResult(req).is_error ? "Falló" : `Listo: ${JSON.parse(lastToolResult(req).content!).resultado}`),
    ]);
    setAgentProvider(provider);
    const r = await runAgentTurn(manager, { message: `Agrega a la lista de colaboradores a ${name}, tiene un salario de 9,000 córdobas y empezó el 21 de octubre de 2026` }, { now: TODAY });
    expect(r.status).toBe("ok");
    expect(r.actions[0]).toMatchObject({ tool: "create_employee", status: "ejecutada" });
    expect(r.reply).toContain("Colaborador registrado");
    const [emp] = await asSystem(({ tx }) => tx.select().from(employees).where(eq(employees.fullName, name)));
    expect(emp.startDate).toBe("2026-10-21");
    const [sal] = await asSystem(({ tx }) => tx.select().from(employeeSalaryHistory).where(eq(employeeSalaryHistory.employeeId, emp.id)));
    expect(sal).toMatchObject({ salary: 9000, currency: "NIO" });
    const logs = await asSystem(({ tx }) => tx.select().from(aiActionLogs).where(eq(aiActionLogs.conversationId, r.status === "ok" ? r.conversationId : "")));
    expect(logs[0]).toMatchObject({ toolName: "create_employee", status: "ejecutada" });
    const audit = await asSystem(({ tx }) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, emp.id)));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["employee.create", "agent.create_employee"]));
    expect(audit.find((a) => a.action === "employee.create")!.source).toBe("agent");

    // Segunda vez: el servicio detecta el duplicado y el agente recibe el error (no afirma éxito)
    setAgentProvider(scripted([() => toolUse("create_employee", { fullName: name, startDate: "2026-10-21" }), (req) => say(lastToolResult(req).is_error ? "Ya existe un colaborador con ese nombre." : "Creado")]));
    const r2 = await runAgentTurn(manager, { message: `Agrega a ${name}` }, { now: TODAY });
    expect(r2.status === "ok" && r2.actions[0].status).toBe("fallida");
    expect(r2.status === "ok" && r2.reply).toBe("Ya existe un colaborador con ese nombre.");
  });

  it("registra un gasto, crea un prospecto y responde consultas de producción y publicaciones", async () => {
    const manager = await makeUser("gerencia");
    const lead = uniq("Clínica Mañana");
    setAgentProvider(
      scripted([
        () => ({ content: [
          { type: "tool_use", id: "a", name: "create_expense", input: { name: uniq("Suscripción IA"), category: "ia", amount: 80, currency: "USD" } },
          { type: "tool_use", id: "b", name: "create_lead", input: { tradeName: lead, nextFollowupAt: "2026-10-23", nextAction: "Llamar" } },
          { type: "tool_use", id: "c", name: "get_production_status", input: {} },
          { type: "tool_use", id: "d", name: "get_publication_status", input: {} },
        ], stopReason: "tool_use" }),
        (req) => {
          const results = req.messages.at(-1)!.content as { tool_use_id: string; is_error?: boolean }[];
          expect(results).toHaveLength(4); // todos los resultados en un único mensaje
          return say(results.every((x) => !x.is_error) ? "Hecho" : "Error");
        },
      ]),
    );
    const r = await runAgentTurn(manager, { message: "Registra un gasto de 80 dólares por herramientas de IA, crea un prospecto para llamar mañana y dime cómo va producción y publicaciones" }, { now: TODAY });
    expect(r.status === "ok" && r.reply).toBe("Hecho");
    const [l] = await asSystem(({ tx }) => tx.select().from(leads).where(eq(leads.tradeName, lead)));
    expect(l.nextFollowupAt).toBe("2026-10-23");
    const exp = await asSystem(({ tx }) => tx.select().from(expenses).where(eq(expenses.amount, 80)));
    expect(exp.some((e) => e.status === "pendiente")).toBe(true);
  });

  it("programa una sesión y actualiza un entregable", async () => {
    const manager = await makeUser("gerencia");
    const c = (await as(manager, (ctx) => createClient(ctx, { client: { tradeName: uniq("Agenda IA") }, contract: standardContract() }), TODAY)).client;
    const board = (await as(manager, (ctx) => getBoardByClientPeriod(ctx, c.id, "2026-10-01"), TODAY))!;
    const reel = board.deliverables.find((d) => d.kind === "reel")!;
    setAgentProvider(scripted([
      () => ({ content: [
        { type: "tool_use", id: "s", name: "schedule_content_session", input: { client: c.tradeName, date: "2026-11-05", confirmed: true, startTime: "09:00" } },
        { type: "tool_use", id: "u", name: "update_deliverable_status", input: { deliverableId: reel.id, status: "editado" } },
      ], stopReason: "tool_use" }),
      () => say("ok"),
    ]));
    const r = await runAgentTurn(manager, { message: "Programa la sesión para el 5 de noviembre y marca el reel 1 como editado" }, { now: TODAY });
    expect(r.status === "ok" && r.actions.map((a) => a.status)).toEqual(["ejecutada", "fallida"]); // sin archivo final no se completa
  });

  it("respeta permisos: un CM no ve herramientas de salarios y un intento es denegado", async () => {
    const cm = await makeUser("community_manager");
    const provider = scripted([() => toolUse("create_employee", { fullName: "X", startDate: "2026-10-01" }), () => say("No tengo permiso")]);
    setAgentProvider(provider);
    const r = await runAgentTurn(cm, { message: "agrega un colaborador" }, { now: TODAY });
    expect(provider.requests[0].tools.map((t) => t.name)).not.toContain("create_employee");
    expect(r.status === "ok" && r.actions[0].status).toBe("denegada");
  });

  it("pide confirmación para acciones sensibles y solo ejecuta tras confirmar", async () => {
    const manager = await makeUser("gerencia");
    const c = (await as(manager, (ctx) => createClient(ctx, { client: { tradeName: uniq("Sensible") }, contract: standardContract() }), TODAY)).client;
    setAgentProvider(scripted([() => toolUse("archive_client", { client: c.tradeName, reason: "Terminó contrato" }), (req) => say(String(lastToolResult(req).content).startsWith("PENDIENTE") ? "Queda pendiente de tu confirmación." : "Archivado")]));
    const r = await runAgentTurn(manager, { message: `Archiva a ${c.tradeName}` }, { now: TODAY });
    if (r.status !== "ok") throw new Error("estado inesperado");
    expect(r.reply).toBe("Queda pendiente de tu confirmación.");
    expect(r.pending).toHaveLength(1);
    const [still] = await asSystem(({ tx }) => tx.execute(`select status from clients where id = '${c.id}'`).then((x) => x.rows as { status: string }[]));
    expect(still.status).toBe("en_incorporacion");
    const done = await resolvePendingAction(manager, r.pending[0].id, "confirmar", { now: TODAY });
    expect(done.status).toBe("ejecutada");
    const [after] = await asSystem(({ tx }) => tx.execute(`select status from clients where id = '${c.id}'`).then((x) => x.rows as { status: string }[]));
    expect(after.status).toBe("archivado");
    await expect(resolvePendingAction(manager, r.pending[0].id, "confirmar", { now: TODAY })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("Errores del proveedor de IA", () => {
  it("traduce clave inválida, falta de saldo y saturación a mensajes claros", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { explainProviderError } = await import("@/server/agent/provider");
    const gen = (status: number, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers());
    expect(explainProviderError(gen(401, "invalid x-api-key")).message).toMatch(/no es válida/);
    expect(explainProviderError(gen(400, "Your credit balance is too low")).message).toMatch(/no tiene saldo/);
    expect(explainProviderError(gen(529, "Overloaded")).message).toMatch(/saturado/);
  });
});

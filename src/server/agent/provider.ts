import Anthropic from "@anthropic-ai/sdk";

export type AgentBlock = Anthropic.Beta.BetaContentBlock;
export type AgentMessage = Anthropic.Beta.BetaMessageParam;
export type AgentTool = Anthropic.Beta.BetaTool;

export type CompletionRequest = { system: string; messages: AgentMessage[]; tools: AgentTool[] };
export type CompletionResponse = { content: AgentBlock[]; stopReason: string | null; model: string };

export interface AgentProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

/** Proveedor Anthropic (Claude). La clave vive solo en el servidor (variables de entorno). */
class AnthropicProvider implements AgentProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools,
      messages: req.messages,
      output_config: { effort: "medium" },
      // Si un clasificador de seguridad rechaza la petición, la API la reintenta con el modelo recomendado.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    return { content: response.content, stopReason: response.stop_reason, model: response.model };
  }
}

let override: AgentProvider | null | undefined;

/** Solo para pruebas: inyecta un proveedor determinista. */
export function setAgentProvider(p: AgentProvider | null | undefined) {
  override = p;
}

/** Devuelve el proveedor configurado o null si falta configuración (nunca se simula una respuesta). */
export function getAgentProvider(): AgentProvider | null {
  if (override !== undefined) return override;
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  if (provider !== "anthropic") return null;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new AnthropicProvider(key, process.env.AI_MODEL || "claude-opus-5-5");
}

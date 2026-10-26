import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "../errors";

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
    try {
      return await this.request(req);
    } catch (e) {
      throw explainProviderError(e);
    }
  }
  private async request(req: CompletionRequest): Promise<CompletionResponse> {
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

/** Traduce los errores de la API de Anthropic a mensajes claros para Gerencia (sin exponer la clave). */
export function explainProviderError(e: unknown): Error {
  if (!(e instanceof Anthropic.APIError)) return e as Error;
  const detail = String(e.message ?? "").toLowerCase();
  if (e.status === 401) return new AppError("NOT_CONFIGURED", "La clave de Anthropic (ANTHROPIC_API_KEY) no es válida. Revisa que la copiaste completa en Vercel, sin espacios, y vuelve a desplegar.");
  if (e.status === 403) return new AppError("NOT_CONFIGURED", "La clave de Anthropic no tiene permiso para usar este modelo. Revisa la clave en console.anthropic.com.");
  if (detail.includes("credit") || detail.includes("billing")) return new AppError("NOT_CONFIGURED", "La cuenta de Anthropic no tiene saldo. Agrega créditos en console.anthropic.com → Billing.");
  if (e.status === 404) return new AppError("NOT_CONFIGURED", "El modelo configurado en AI_MODEL no está disponible para tu cuenta. Borra AI_MODEL en Vercel para usar el predeterminado.");
  if (e.status === 429) return new AppError("CONFLICT", "Se alcanzó el límite de uso de Anthropic por ahora. Espera un minuto y vuelve a intentarlo.");
  if (e.status === 529 || (e.status ?? 0) >= 500) return new AppError("CONFLICT", "El servicio de Claude está saturado o no responde en este momento. Intenta de nuevo en unos minutos.");
  return e;
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
  const key = process.env.ANTHROPIC_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!key) return null;
  return new AnthropicProvider(key, process.env.AI_MODEL?.trim() || "claude-opus-5-5");
}

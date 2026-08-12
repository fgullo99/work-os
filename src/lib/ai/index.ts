import { AnthropicProvider } from "./anthropicProvider";
import type { AIProvider } from "./types";

export type {
  AIProvider,
  AiUsage,
  NormalizeManualCaptureInput,
  NormalizeEmailThreadInput,
  NormalizeWhatsAppConversationInput,
} from "./types";
export { AINormalizationError } from "./types";
export type { ManualCaptureResult } from "./schema";
export type { EmailThreadResult } from "./emailSchema";
export type { WhatsAppConversationResult } from "./whatsappSchema";

let cached: AIProvider | null = null;

/**
 * Punto unico de acceso al AI Provider activo. Para agregar/cambiar de proveedor:
 * 1) implementar la interfaz AIProvider (./types.ts) en un archivo nuevo (ej. openaiProvider.ts)
 * 2) agregar el case correspondiente aca abajo, leyendo AI_PROVIDER del .env
 * Nada fuera de este archivo necesita cambiar.
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;

  const providerName = process.env.AI_PROVIDER ?? "anthropic";

  switch (providerName) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en las variables de entorno.");
      cached = new AnthropicProvider(apiKey, process.env.ANTHROPIC_MODEL);
      return cached;
    }
    default:
      throw new Error(`AI_PROVIDER desconocido: "${providerName}". Valores soportados en V1: "anthropic".`);
  }
}

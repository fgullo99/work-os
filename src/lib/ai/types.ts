import type { ManualCaptureResult } from "./schema";
import type { EmailThreadResult } from "./emailSchema";
import type { WhatsAppConversationResult } from "./whatsappSchema";
import type { ExistingWorkItemSummary, NormalizedThread } from "@/lib/gmail/types";
import type { ZapiaConversationUnit } from "@/lib/whatsapp/zapiaSchema";

export interface NormalizeManualCaptureInput {
  /** Texto tal cual lo escribio el usuario. No se modifica antes de mandarlo al modelo. */
  text: string;
  /** "Hoy" en America/Argentina/Buenos_Aires, formato YYYY-MM-DD. Nunca UTC. */
  currentDateISO: string;
}

export interface NormalizeEmailThreadInput {
  thread: NormalizedThread;
  existingWorkItem: ExistingWorkItemSummary | null;
  /** "Hoy" en America/Argentina/Buenos_Aires, formato YYYY-MM-DD. Nunca UTC. */
  currentDateISO: string;
  /** Direcciones de la cuenta conectada (USER_EMAIL_ADDRESSES) — se le muestran al modelo
   * junto a To/Cc de cada mensaje para que pueda determinar attention_owner (a quien le
   * corresponde la proxima accion) sin confundir "el usuario esta en Cc" con "el usuario es
   * el responsable". Ver src/lib/gmail/contextWindow.ts. */
  userAddresses: string[];
}

export interface NormalizeWhatsAppConversationInput {
  unit: ZapiaConversationUnit;
  existingWorkItem: ExistingWorkItemSummary | null;
  /** "Hoy" en America/Argentina/Buenos_Aires, formato YYYY-MM-DD. Nunca UTC. */
  currentDateISO: string;
}

/** Tokens de una sola llamada al modelo — para telemetria de costo (ver catchup.ts). Nunca
 * incluye contenido, solo conteos que ya devuelve el proveedor. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Interfaz que debe implementar cualquier proveedor de IA usado por el Normalizer.
 * Todo el resto de la aplicacion depende SOLO de esta interfaz, nunca de un SDK
 * de proveedor especifico. Cambiar de proveedor = escribir una clase nueva que la
 * implemente y apuntar el factory (./index.ts) a ella.
 */
export interface AIProvider {
  /** onUsage es opcional y puramente informativo (telemetria de costo) — ningun llamador
   * existente necesita pasarlo, y ninguna decision de negocio depende de el. */
  normalizeManualCapture(input: NormalizeManualCaptureInput, onUsage?: (usage: AiUsage) => void): Promise<ManualCaptureResult>;
  normalizeEmailThread(input: NormalizeEmailThreadInput, onUsage?: (usage: AiUsage) => void): Promise<EmailThreadResult>;
  normalizeWhatsAppConversation(input: NormalizeWhatsAppConversationInput, onUsage?: (usage: AiUsage) => void): Promise<WhatsAppConversationResult>;
  /** Nombre real del modelo configurado — solo para paneles informativos (Settings → AI Engine). */
  getModel(): string;
}

export class AINormalizationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AINormalizationError";
  }
}

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
}

export interface NormalizeWhatsAppConversationInput {
  unit: ZapiaConversationUnit;
  existingWorkItem: ExistingWorkItemSummary | null;
  /** "Hoy" en America/Argentina/Buenos_Aires, formato YYYY-MM-DD. Nunca UTC. */
  currentDateISO: string;
}

/**
 * Interfaz que debe implementar cualquier proveedor de IA usado por el Normalizer.
 * Todo el resto de la aplicacion depende SOLO de esta interfaz, nunca de un SDK
 * de proveedor especifico. Cambiar de proveedor = escribir una clase nueva que la
 * implemente y apuntar el factory (./index.ts) a ella.
 */
export interface AIProvider {
  normalizeManualCapture(input: NormalizeManualCaptureInput): Promise<ManualCaptureResult>;
  normalizeEmailThread(input: NormalizeEmailThreadInput): Promise<EmailThreadResult>;
  normalizeWhatsAppConversation(input: NormalizeWhatsAppConversationInput): Promise<WhatsAppConversationResult>;
  /** Nombre real del modelo configurado — solo para paneles informativos (Settings → AI Engine). */
  getModel(): string;
}

export class AINormalizationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AINormalizationError";
  }
}

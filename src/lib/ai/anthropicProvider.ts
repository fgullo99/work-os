import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { manualCaptureResultSchema, type ManualCaptureResult } from "./schema";
import { buildManualCaptureSystemPrompt } from "./prompt";
import { emailThreadResultSchema, type EmailThreadResult } from "./emailSchema";
import { buildEmailThreadSystemPrompt } from "./emailPrompt";
import { whatsappConversationResultSchema, type WhatsAppConversationResult } from "./whatsappSchema";
import { buildWhatsAppConversationSystemPrompt } from "./whatsappPrompt";
import { caseStateResultSchema, type CaseStateResult } from "./caseSchema";
import { buildCaseStateSystemPrompt } from "./casePrompt";
import { buildThreadContextText } from "@/lib/gmail/contextWindow";
import { buildWhatsAppContextText } from "@/lib/whatsapp/whatsappContext";
import { buildCaseHistoryText } from "@/lib/cases/caseHistoryText";
import {
  AINormalizationError,
  type AiUsage,
  type AIProvider,
  type NormalizeEmailThreadInput,
  type NormalizeManualCaptureInput,
  type NormalizeWhatsAppConversationInput,
  type NormalizeCaseStateInput,
} from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

const MANUAL_TOOL_NAME = "record_classification";
const EMAIL_TOOL_NAME = "record_email_classification";
const WHATSAPP_TOOL_NAME = "record_whatsapp_classification";
const CASE_TOOL_NAME = "record_case_state";

// Mantenidos sincronizados a mano con manualCaptureResultSchema/emailThreadResultSchema.
// No se generan automaticamente para no agregar una dependencia (zod-to-json-schema)
// solo para este uso.
const MANUAL_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    next_action: { type: ["string", "null"] },
    waiting_for_person: { type: ["string", "null"] },
    waiting_for_what: { type: ["string", "null"] },
    due_date_phrase: { type: ["string", "null"] },
    expected_date_phrase: { type: ["string", "null"] },
    committed_date_phrase: { type: ["string", "null"] },
    suggested_company: { type: ["string", "null"] },
    suggested_contact: { type: ["string", "null"] },
    suggested_context: { type: ["string", "null"] },
    suggested_category: {
      type: ["string", "null"],
      enum: ["COMERCIAL", "TECNICO", "OPERACIONES", "ADMINISTRATIVO", null],
    },
    blocking: { type: "boolean" },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    summary: { type: "string" },
  },
  required: [
    "title",
    "next_action",
    "waiting_for_person",
    "waiting_for_what",
    "due_date_phrase",
    "expected_date_phrase",
    "committed_date_phrase",
    "suggested_company",
    "suggested_contact",
    "suggested_context",
    "suggested_category",
    "blocking",
    "confidence",
    "summary",
  ],
} as const;

const EMAIL_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    relevance: { type: "string", enum: ["WORK", "PERSONAL", "UNCERTAIN"] },
    classification: { type: "string", enum: ["ACTION", "WAITING", "COMMITMENT", "INFO", "IGNORE"] },
    attention_owner: { type: "string", enum: ["FELIPE", "TEAM_OTHER", "EXTERNAL", "SHARED", "UNKNOWN"] },
    team_other_relation: {
      type: ["string", "null"],
      enum: ["DELEGATED_BY_FELIPE", "OWNED_BY_OTHER", "FYI_ONLY", "BLOCKS_FELIPE", "AMBIGUOUS", null],
    },
    next_action: { type: ["string", "null"] },
    waiting_for_person: { type: ["string", "null"] },
    waiting_for_what: { type: ["string", "null"] },
    due_date_phrase: { type: ["string", "null"] },
    expected_date_phrase: { type: ["string", "null"] },
    committed_date_phrase: { type: ["string", "null"] },
    is_delegation: { type: "boolean" },
    suggested_company: { type: ["string", "null"] },
    suggested_contact: { type: ["string", "null"] },
    suggested_context: { type: ["string", "null"] },
    suggested_category: {
      type: ["string", "null"],
      enum: ["COMERCIAL", "TECNICO", "OPERACIONES", "ADMINISTRATIVO", null],
    },
    blocking: { type: "boolean" },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    rationale: { type: "string" },
    evidence: { type: ["string", "null"] },
    summary: { type: "string" },
  },
  required: [
    "relevance",
    "classification",
    "attention_owner",
    "team_other_relation",
    "next_action",
    "waiting_for_person",
    "waiting_for_what",
    "due_date_phrase",
    "expected_date_phrase",
    "committed_date_phrase",
    "is_delegation",
    "suggested_company",
    "suggested_contact",
    "suggested_context",
    "suggested_category",
    "blocking",
    "confidence",
    "rationale",
    "evidence",
    "summary",
  ],
} as const;

const WHATSAPP_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    relevance: { type: "string", enum: ["WORK", "PERSONAL", "UNCERTAIN"] },
    classification: { type: "string", enum: ["ACTION", "WAITING", "COMMITMENT", "INFO", "IGNORE"] },
    next_action: { type: ["string", "null"] },
    waiting_for_person: { type: ["string", "null"] },
    waiting_for_what: { type: ["string", "null"] },
    due_date_phrase: { type: ["string", "null"] },
    expected_date_phrase: { type: ["string", "null"] },
    committed_date_phrase: { type: ["string", "null"] },
    responsible: { type: ["string", "null"] },
    suggested_company: { type: ["string", "null"] },
    suggested_contact: { type: ["string", "null"] },
    suggested_context: { type: ["string", "null"] },
    suggested_category: {
      type: ["string", "null"],
      enum: ["COMERCIAL", "TECNICO", "OPERACIONES", "ADMINISTRATIVO", null],
    },
    blocking: { type: "boolean" },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    evidence: { type: ["string", "null"] },
    summary: { type: "string" },
  },
  required: [
    "relevance",
    "classification",
    "next_action",
    "waiting_for_person",
    "waiting_for_what",
    "due_date_phrase",
    "expected_date_phrase",
    "committed_date_phrase",
    "responsible",
    "suggested_company",
    "suggested_contact",
    "suggested_context",
    "suggested_category",
    "blocking",
    "confidence",
    "evidence",
    "summary",
  ],
} as const;

const CASE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    case_title: { type: "string" },
    reference_type: {
      type: ["string", "null"],
      enum: ["QUOTE", "PURCHASE_ORDER", "RFQ", "PROJECT", "INVOICE", "SALES_ORDER", "OTHER", null],
    },
    reference_value: { type: ["string", "null"] },
    current_state: {
      type: "string",
      enum: ["ACTION_ME", "WAITING_EXTERNAL", "DELEGATED_INTERNAL", "BLOCKED", "NO_ACTION", "CLOSED", "REVIEW"],
    },
    current_owner: { type: "string", enum: ["FELIPE", "TEAM", "EXTERNAL", "NONE", "UNKNOWN"] },
    felipe_action_required: { type: "boolean" },
    next_action: { type: ["string", "null"] },
    waiting_for: { type: ["string", "null"] },
    responsible: { type: ["string", "null"] },
    due_date_phrase: { type: ["string", "null"] },
    expected_date_phrase: { type: ["string", "null"] },
    last_meaningful_event: { type: "string" },
    risk: { type: "string", enum: ["NORMAL", "AT_RISK"] },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    closure_evidence_unambiguous: { type: "boolean" },
    summary: { type: "string" },
  },
  required: [
    "case_title",
    "reference_type",
    "reference_value",
    "current_state",
    "current_owner",
    "felipe_action_required",
    "next_action",
    "waiting_for",
    "responsible",
    "due_date_phrase",
    "expected_date_phrase",
    "last_meaningful_event",
    "risk",
    "confidence",
    "closure_evidence_unambiguous",
    "summary",
  ],
} as const;

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = DEFAULT_ANTHROPIC_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /** Solo para paneles informativos (Settings → AI Engine) — nunca decide comportamiento. */
  getModel(): string {
    return this.model;
  }

  /**
   * Llama a una tool forzada, valida la respuesta con Zod, y reintenta UNA vez con el
   * detalle del error si la primera salida no cumplio el schema. Compartido por los dos
   * normalizers (captura manual y thread de Gmail) para no duplicar esta logica.
   */
  private async callToolWithRetry<T>(params: {
    system: string;
    userContent: string;
    toolName: string;
    toolDescription: string;
    toolInputSchema: unknown;
    zodSchema: ZodType<T>;
    /** Puramente informativo (telemetria de costo) — nunca afecta el resultado. */
    onUsage?: (usage: AiUsage) => void;
  }): Promise<T> {
    const attempt = async (extraNote?: string) => {
      // El request se tipa como `any` a proposito: el shape exacto de `tools[].input_schema`
      // varia levemente entre versiones del SDK de Anthropic y no vale la pena acoplarse a un
      // tipo interno del SDK aca — la forma REAL de la respuesta igual se valida con Zod abajo.
      const requestParams: any = {
        model: this.model,
        max_tokens: 1024,
        system: params.system,
        messages: [
          {
            role: "user",
            content: extraNote ? `${params.userContent}\n\n(${extraNote})` : params.userContent,
          },
        ],
        tools: [
          {
            name: params.toolName,
            description: params.toolDescription,
            input_schema: params.toolInputSchema,
          },
        ],
        tool_choice: { type: "tool", name: params.toolName },
      };
      const message = await this.client.messages.create(requestParams);

      if (params.onUsage && message.usage) {
        params.onUsage({
          inputTokens: message.usage.input_tokens ?? 0,
          outputTokens: message.usage.output_tokens ?? 0,
        });
      }

      const toolUse = message.content.find((block: { type: string }) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new AINormalizationError("El modelo no devolvio una llamada a la herramienta esperada.");
      }
      return toolUse.input;
    };

    let raw: unknown;
    try {
      raw = await attempt();
    } catch (err) {
      throw new AINormalizationError("Fallo la llamada al proveedor de IA.", err);
    }

    const parsed = params.zodSchema.safeParse(raw);
    if (parsed.success) return parsed.data;

    // Un reintento con el detalle del error de validacion suele alcanzar para corregir
    // salidas mal formadas (ej. un enum invalido) sin gastar una llamada extra "a ciegas".
    let retryRaw: unknown;
    try {
      retryRaw = await attempt(`Tu respuesta anterior no cumplio el schema requerido: ${parsed.error.message}. Corregila.`);
    } catch (err) {
      throw new AINormalizationError("Fallo el reintento de llamada al proveedor de IA.", err);
    }

    const retryParsed = params.zodSchema.safeParse(retryRaw);
    if (retryParsed.success) return retryParsed.data;

    throw new AINormalizationError("El modelo no devolvio una estructura valida despues de reintentar.", retryParsed.error);
  }

  async normalizeManualCapture(input: NormalizeManualCaptureInput, onUsage?: (usage: AiUsage) => void): Promise<ManualCaptureResult> {
    return this.callToolWithRetry({
      system: buildManualCaptureSystemPrompt(input.currentDateISO),
      userContent: input.text,
      toolName: MANUAL_TOOL_NAME,
      toolDescription: "Registra la clasificacion estructurada del texto de captura manual.",
      toolInputSchema: MANUAL_TOOL_INPUT_SCHEMA,
      zodSchema: manualCaptureResultSchema,
      onUsage,
    });
  }

  async normalizeEmailThread(input: NormalizeEmailThreadInput, onUsage?: (usage: AiUsage) => void): Promise<EmailThreadResult> {
    const contextText = buildThreadContextText(input.thread, input.existingWorkItem, input.userAddresses);
    return this.callToolWithRetry({
      system: buildEmailThreadSystemPrompt(input.currentDateISO),
      userContent: contextText,
      toolName: EMAIL_TOOL_NAME,
      toolDescription: "Registra la clasificacion estructurada del thread de Gmail.",
      toolInputSchema: EMAIL_TOOL_INPUT_SCHEMA,
      zodSchema: emailThreadResultSchema,
      onUsage,
    });
  }

  async normalizeWhatsAppConversation(
    input: NormalizeWhatsAppConversationInput,
    onUsage?: (usage: AiUsage) => void
  ): Promise<WhatsAppConversationResult> {
    const contextText = buildWhatsAppContextText(input.unit, input.existingWorkItem);
    return this.callToolWithRetry({
      system: buildWhatsAppConversationSystemPrompt(input.currentDateISO),
      userContent: contextText,
      toolName: WHATSAPP_TOOL_NAME,
      toolDescription: "Registra la clasificacion estructurada de la conversacion de WhatsApp.",
      toolInputSchema: WHATSAPP_TOOL_INPUT_SCHEMA,
      zodSchema: whatsappConversationResultSchema,
      onUsage,
    });
  }

  async analyzeCaseState(input: NormalizeCaseStateInput, onUsage?: (usage: AiUsage) => void): Promise<CaseStateResult> {
    const historyText = buildCaseHistoryText(
      input.caseTitle,
      input.referenceLabel,
      input.entries,
      input.internalTeamMembers,
      input.existing
    );
    return this.callToolWithRetry({
      system: buildCaseStateSystemPrompt(input.currentDateISO),
      userContent: historyText,
      toolName: CASE_TOOL_NAME,
      toolDescription: "Registra el estado actual del Case (asunto de trabajo) analizado.",
      toolInputSchema: CASE_TOOL_INPUT_SCHEMA,
      zodSchema: caseStateResultSchema,
      onUsage,
    });
  }
}

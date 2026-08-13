import { describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

// Import despues del mock — AnthropicProvider construye el cliente en el constructor.
const { AnthropicProvider } = await import("./anthropicProvider");

function toolUseMessage(input: Record<string, unknown>, usage?: { input_tokens: number; output_tokens: number }) {
  return {
    content: [{ type: "tool_use", input }],
    usage: usage ?? { input_tokens: 100, output_tokens: 50 },
  };
}

function validEmailInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    relevance: "WORK",
    classification: "ACTION",
    attention_owner: "FELIPE",
    team_other_relation: null,
    next_action: "Responder",
    waiting_for_person: null,
    waiting_for_what: null,
    due_date_phrase: null,
    expected_date_phrase: null,
    committed_date_phrase: null,
    is_delegation: false,
    suggested_company: null,
    suggested_contact: null,
    suggested_context: null,
    suggested_category: null,
    blocking: false,
    confidence: "HIGH",
    rationale: "test",
    evidence: "test",
    summary: "resumen normal",
    ...overrides,
  };
}

describe("AnthropicProvider.normalizeEmailThread — summary largo no debe disparar retry (bug demostrado)", () => {
  it("un summary de 237 caracteres (caso real) resuelve en UNA sola llamada al modelo, no dos", async () => {
    createMock.mockReset();
    createMock.mockResolvedValueOnce(toolUseMessage(validEmailInput({ summary: "a".repeat(237) })));

    const provider = new AnthropicProvider("fake-key");
    const usageCalls: Array<{ inputTokens: number; outputTokens: number }> = [];

    const result = await provider.normalizeEmailThread(
      {
        thread: { threadId: "t-1", subject: "test", messages: [] } as any,
        existingWorkItem: null,
        currentDateISO: "2026-08-12",
        userAddresses: ["me@tmc.com"],
      },
      (usage) => usageCalls.push(usage)
    );

    // UNA sola llamada al modelo — la desviacion de longitud de summary no genero un
    // segundo intento (antes del fix, el ZodError por .max(200) forzaba un retry aca).
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(usageCalls).toHaveLength(1);
    expect(result.summary.length).toBeLessThanOrEqual(200);
  });

  it("un thread valido con un error real de schema (no summary) SI sigue reintentando una vez", async () => {
    createMock.mockReset();
    // primer intento: falta un campo requerido (relevance) -> Zod rechaza -> retry
    const { relevance, ...withoutRelevance } = validEmailInput();
    createMock.mockResolvedValueOnce(toolUseMessage(withoutRelevance));
    createMock.mockResolvedValueOnce(toolUseMessage(validEmailInput()));

    const provider = new AnthropicProvider("fake-key");
    const result = await provider.normalizeEmailThread({
      thread: { threadId: "t-1", subject: "test", messages: [] } as any,
      existingWorkItem: null,
      currentDateISO: "2026-08-12",
      userAddresses: ["me@tmc.com"],
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result.relevance).toBe("WORK");
  });
});

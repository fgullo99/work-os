import { describe, expect, it } from "vitest";
import { applyRuleFilter } from "./ruleFilter";
import type { NormalizedMessage, NormalizedThread } from "./types";

function msg(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    id: "m1",
    direction: "INBOUND",
    from: "someone@example.com",
    fromName: null,
    to: [],
    cc: [],
    subject: "Asunto",
    date: "2026-08-10T10:00:00.000Z",
    snippet: "snippet",
    bodyText: "cuerpo",
    hasListUnsubscribe: false,
    ...overrides,
  };
}

function thread(messages: NormalizedMessage[]): NormalizedThread {
  return { threadId: "t1", historyId: null, messages, subject: "Asunto", webUrl: "https://mail.google.com/x" };
}

describe("applyRuleFilter", () => {
  it("descarta un thread sin mensajes", () => {
    const result = applyRuleFilter(thread([]));
    expect(result.skip).toBe(true);
  });

  it("descarta newsletter puro: todos List-Unsubscribe, sin actividad propia", () => {
    const result = applyRuleFilter(
      thread([msg({ hasListUnsubscribe: true, direction: "INBOUND" }), msg({ hasListUnsubscribe: true, direction: "INBOUND" })])
    );
    expect(result.skip).toBe(true);
    expect(result.reason).toMatch(/bulk|newsletter/i);
  });

  it("NO descarta si hay List-Unsubscribe pero tambien hubo actividad propia (respondimos)", () => {
    const result = applyRuleFilter(thread([msg({ hasListUnsubscribe: true, direction: "INBOUND" }), msg({ direction: "OUTBOUND" })]));
    expect(result.skip).toBe(false);
  });

  it("NO descarta automaticamente por remitente noreply", () => {
    const result = applyRuleFilter(thread([msg({ from: "noreply@proveedor.com", hasListUnsubscribe: false })]));
    expect(result.skip).toBe(false);
  });

  it("un thread normal (conversacion real) nunca se descarta", () => {
    const result = applyRuleFilter(
      thread([msg({ direction: "INBOUND" }), msg({ direction: "OUTBOUND" }), msg({ direction: "INBOUND" })])
    );
    expect(result.skip).toBe(false);
  });
});

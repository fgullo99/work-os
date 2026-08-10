import { describe, expect, it } from "vitest";
import { parseZapiaPayload } from "./zapiaSchema";

const validSingleMessage = {
  source: "whatsapp",
  provider: "zapia",
  batch_id: "b1",
  captured_at: "2026-08-10T15:00:00Z",
  timezone: "America/Argentina/Buenos_Aires",
  conversation: { chat_name: "Cliente A", contact_name: "Juan", phone: "+5491111", chat_id: "chat-1" },
  messages: [{ message_id: "m1", direction: "inbound", sent_at: "2026-08-10T14:55:00Z", text: "Mandame el precio." }],
};

describe("parseZapiaPayload", () => {
  it("accepts a valid single-conversation payload with one message", () => {
    const result = parseZapiaPayload(validSingleMessage);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.units).toHaveLength(1);
      expect(result.units[0]?.messages).toHaveLength(1);
    }
  });

  it("accepts a valid multi-message conversation", () => {
    const payload = {
      ...validSingleMessage,
      messages: [
        { message_id: "m1", direction: "inbound", sent_at: "t1", text: "Mandame el precio." },
        { message_id: "m2", direction: "outbound", sent_at: "t2", text: "Te lo mando mañana." },
      ],
    };
    const result = parseZapiaPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.units[0]?.messages).toHaveLength(2);
  });

  it("allows null/missing optional fields", () => {
    const payload = {
      source: "whatsapp",
      provider: "zapia",
      conversation: { chat_name: null, contact_name: null, phone: null, chat_id: null },
      messages: [{ direction: "unknown", text: "hola" }],
    };
    const result = parseZapiaPayload(payload);
    expect(result.ok).toBe(true);
  });

  it("rejects a payload missing messages", () => {
    const { messages, ...withoutMessages } = validSingleMessage;
    const result = parseZapiaPayload(withoutMessages);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload with an empty messages array", () => {
    const result = parseZapiaPayload({ ...validSingleMessage, messages: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects a message with an invalid direction", () => {
    const payload = { ...validSingleMessage, messages: [{ direction: "sideways", text: "hola" }] };
    const result = parseZapiaPayload(payload);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseZapiaPayload("just a string").ok).toBe(false);
    expect(parseZapiaPayload(null).ok).toBe(false);
    expect(parseZapiaPayload(42).ok).toBe(false);
  });

  it("accepts a batch payload with multiple conversations", () => {
    const payload = {
      batch_id: "batch-1",
      timezone: "America/Argentina/Buenos_Aires",
      conversations: [
        { conversation: { chat_id: "chat-1", chat_name: null, contact_name: "Juan", phone: null }, messages: [{ direction: "inbound", text: "hola 1" }] },
        { conversation: { chat_id: "chat-2", chat_name: null, contact_name: "Maria", phone: null }, messages: [{ direction: "outbound", text: "hola 2" }] },
      ],
    };
    const result = parseZapiaPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.units).toHaveLength(2);
      expect(result.units[0]?.batchId).toBe("batch-1");
      expect(result.units[1]?.conversation.chat_id).toBe("chat-2");
    }
  });

  it("rejects a batch payload with an empty conversations array", () => {
    const result = parseZapiaPayload({ batch_id: "b", conversations: [] });
    expect(result.ok).toBe(false);
  });

  it("continues to treat a single conversation as non-batch even if batch_id is set", () => {
    const result = parseZapiaPayload(validSingleMessage);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.units).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { buildEventLabel } from "./eventLabel";

describe("buildEventLabel", () => {
  it("email entrante con remitente", () => {
    expect(buildEventLabel({ sourceType: "GMAIL", direction: "INBOUND", from: "cliente@x.com" })).toBe(
      "Email entrante de cliente@x.com"
    );
  });

  it("email saliente con remitente", () => {
    expect(buildEventLabel({ sourceType: "GMAIL", direction: "OUTBOUND", from: "thomas@tmc.com" })).toBe(
      "Email saliente de thomas@tmc.com"
    );
  });

  it("whatsapp entrante", () => {
    expect(buildEventLabel({ sourceType: "WHATSAPP", direction: "INBOUND", from: "Juan" })).toBe("WhatsApp entrante de Juan");
  });

  it("sin direccion, devuelve solo la etiqueta de fuente", () => {
    expect(buildEventLabel({ sourceType: "MANUAL", direction: null, from: null })).toBe("Nota manual");
  });

  it("sin remitente pero con direccion, no deja un 'de' colgado", () => {
    expect(buildEventLabel({ sourceType: "GMAIL", direction: "INBOUND", from: null })).toBe("Email entrante");
  });
});

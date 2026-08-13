import { describe, expect, it } from "vitest";
import { buildCaseHistoryText, type CaseHistoryEntry } from "./caseHistoryText";

const ENTRIES: CaseHistoryEntry[] = [
  { occurredAt: "2026-08-13T00:00:00.000Z", sourceType: "GMAIL", direction: "INBOUND", from: "cliente@x.com", to: ["me@tmc.com"], text: "¿Me cotizan esto?" },
  { occurredAt: "2026-08-01T00:00:00.000Z", sourceType: "GMAIL", direction: "OUTBOUND", from: "felipe@tmc.com", to: ["thomas@tmc.com"], text: "Thomas, prepara la oferta." },
];

describe("buildCaseHistoryText", () => {
  it("ordena los eventos cronologicamente aunque el caller los pase desordenados", () => {
    const text = buildCaseHistoryText("Cotización X", null, ENTRIES, []);
    const posFirst = text.indexOf("Thomas, prepara la oferta.");
    const posSecond = text.indexOf("¿Me cotizan esto?");
    expect(posFirst).toBeGreaterThan(-1);
    expect(posSecond).toBeGreaterThan(posFirst);
  });

  it("incluye el titulo y la referencia si se pasa una", () => {
    const text = buildCaseHistoryText("Cotización S00103", "QUOTE S00103", [], []);
    expect(text).toContain("Case: Cotización S00103");
    expect(text).toContain("Referencia: QUOTE S00103");
  });

  it("incluye el roster interno cuando se pasa", () => {
    const text = buildCaseHistoryText("X", null, [], [{ name: "Thomas", email: "thomas@tmc.com" }]);
    expect(text).toContain("Thomas <thomas@tmc.com>");
  });

  it("incluye De/Para/Cc de cada evento", () => {
    const text = buildCaseHistoryText("X", null, ENTRIES, []);
    expect(text).toContain("De: cliente@x.com");
    expect(text).toContain("Para: me@tmc.com");
  });

  it("incluye el estado ya registrado si se pasa un Case existente", () => {
    const text = buildCaseHistoryText("X", null, [], [], {
      currentState: "DELEGATED_INTERNAL",
      currentOwner: "TEAM",
      nextAction: null,
      waitingFor: "Que Thomas envie la oferta",
    });
    expect(text).toContain("ESTADO ACTUAL YA REGISTRADO");
    expect(text).toContain("current_state: DELEGATED_INTERNAL");
  });

  it("sin Case existente no incluye la seccion de estado previo", () => {
    const text = buildCaseHistoryText("X", null, [], [], null);
    expect(text).not.toContain("ESTADO ACTUAL YA REGISTRADO");
  });
});

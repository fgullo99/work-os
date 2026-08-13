import { describe, expect, it } from "vitest";
import { matchCaseForThread } from "./caseMatch";
import type { CaseRow } from "@/lib/supabase/types";

const TODAY = "2026-08-13T00:00:00.000Z";

function caseRow(overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    id: "case-1",
    title: "Cotización S00103",
    company_id: "company-1",
    contact_id: null,
    context_id: null,
    reference_type: "QUOTE",
    reference_value: "S00103",
    current_state: "WAITING_EXTERNAL",
    current_owner: "EXTERNAL",
    felipe_action_required: false,
    next_action: null,
    waiting_for: "Respuesta del cliente",
    responsible: null,
    due_date: null,
    expected_date: null,
    risk: "NORMAL",
    confidence: "HIGH",
    ai_summary: null,
    last_meaningful_event: "Oferta enviada",
    last_activity_at: TODAY,
    ai_calls_count: 0,
    ai_input_tokens: 0,
    ai_output_tokens: 0,
    is_demo: false,
    created_at: TODAY,
    updated_at: TODAY,
    ...overrides,
  };
}

describe("matchCaseForThread", () => {
  it("EXACT: referencia identica contra un Case abierto -> auto-merge", () => {
    const result = matchCaseForThread(
      { extractedReferences: [{ type: "QUOTE", value: "S00103", matchedText: "S00103" }], companyId: "company-1", threadSubjectOrTitle: "Re: Cotización", occurredAt: TODAY },
      [caseRow()]
    );
    expect(result.tier).toBe("EXACT");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.id).toBe("case-1");
  });

  it("EXACT no depende de company_id — la referencia sola alcanza", () => {
    const result = matchCaseForThread(
      { extractedReferences: [{ type: "QUOTE", value: "S00103", matchedText: "S00103" }], companyId: null, threadSubjectOrTitle: "algo distinto", occurredAt: TODAY },
      [caseRow()]
    );
    expect(result.tier).toBe("EXACT");
  });

  it("STRONG: misma empresa + mismo tipo de referencia (sin coincidir el valor exacto)", () => {
    const result = matchCaseForThread(
      {
        extractedReferences: [{ type: "QUOTE", value: "S00999", matchedText: "S00999" }], // valor distinto, mismo tipo
        companyId: "company-1",
        threadSubjectOrTitle: "algo sin relacion de titulo",
        occurredAt: TODAY,
      },
      [caseRow()]
    );
    expect(result.tier).toBe("STRONG");
  });

  it("STRONG: misma empresa + titulo muy similar (>=0.6), sin referencia", () => {
    const result = matchCaseForThread(
      { extractedReferences: [], companyId: "company-1", threadSubjectOrTitle: "Cotización S00103 transformador", occurredAt: TODAY },
      [caseRow({ reference_type: null, reference_value: null })]
    );
    expect(result.tier).toBe("STRONG");
  });

  it("PROBABLE: misma empresa + similitud moderada + actividad reciente -> nunca auto-merge, va a review", () => {
    const result = matchCaseForThread(
      { extractedReferences: [], companyId: "company-1", threadSubjectOrTitle: "Consulta sobre transformador Cirion", occurredAt: TODAY },
      [caseRow({ title: "Cotización transformador Cirion 3150 kVA", reference_type: null, reference_value: null })]
    );
    expect(result.tier).toBe("PROBABLE");
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("PROBABLE no aplica si la actividad del Case es vieja (fuera de la ventana de 30 dias)", () => {
    const oldDate = "2026-01-01T00:00:00.000Z";
    const result = matchCaseForThread(
      { extractedReferences: [], companyId: "company-1", threadSubjectOrTitle: "Consulta sobre transformador Cirion", occurredAt: TODAY },
      [caseRow({ title: "Cotización transformador Cirion 3150 kVA", reference_type: null, reference_value: null, last_activity_at: oldDate })]
    );
    expect(result.tier).not.toBe("PROBABLE");
  });

  it("NONE: mismo company solo, sin ninguna otra señal -> nunca es suficiente para auto-merge ni siquiera para review (item 17)", () => {
    const result = matchCaseForThread(
      { extractedReferences: [], companyId: "company-1", threadSubjectOrTitle: "Un asunto completamente distinto sin relacion", occurredAt: TODAY },
      [caseRow({ title: "Cotización S00103", reference_type: null, reference_value: null })]
    );
    expect(result.tier).toBe("NONE");
    expect(result.candidates).toEqual([]);
  });

  it("NONE: sin company ni referencia, sin ningun candidato -> crea Case nuevo directo", () => {
    const result = matchCaseForThread(
      { extractedReferences: [], companyId: null, threadSubjectOrTitle: "Consulta nueva", occurredAt: TODAY },
      [caseRow()]
    );
    expect(result.tier).toBe("NONE");
  });

  it("REGRESION item 17: mismo cliente con 5 cotizaciones abiertas, referencias distintas, nunca cruza referencias", () => {
    const openQuotes = ["S00101", "S00102", "S00103", "S00104", "S00105"].map((value) =>
      caseRow({ id: `case-${value}`, title: `Cotización ${value}`, reference_type: "QUOTE", reference_value: value })
    );
    const result = matchCaseForThread(
      { extractedReferences: [{ type: "QUOTE", value: "S00999", matchedText: "S00999" }], companyId: "company-1", threadSubjectOrTitle: "Cotización nueva", occurredAt: TODAY },
      openQuotes
    );
    // hay 5 candidatos con mismo tipo de referencia (QUOTE) -> STRONG con multiples matches,
    // nunca elige uno solo a ciegas.
    expect(result.tier).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(5);
  });

  it("dos Cases abiertos comparten (por error de datos) la misma referencia exacta -> AMBIGUOUS, no elige uno a ciegas", () => {
    const result = matchCaseForThread(
      { extractedReferences: [{ type: "QUOTE", value: "S00103", matchedText: "S00103" }], companyId: "company-1", threadSubjectOrTitle: "x", occurredAt: TODAY },
      [caseRow({ id: "case-a" }), caseRow({ id: "case-b" })]
    );
    expect(result.tier).toBe("AMBIGUOUS");
    expect(result.candidates).toHaveLength(2);
  });

  it("Case cerrado no matchea si el caller no lo incluye en openCases (comportamiento esperado: filtrar antes de llamar)", () => {
    const result = matchCaseForThread(
      { extractedReferences: [{ type: "QUOTE", value: "S00103", matchedText: "S00103" }], companyId: "company-1", threadSubjectOrTitle: "x", occurredAt: TODAY },
      [] // caller ya filtro los CLOSED
    );
    expect(result.tier).toBe("NONE");
  });
});

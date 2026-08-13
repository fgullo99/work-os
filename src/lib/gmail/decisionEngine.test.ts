import { describe, expect, it } from "vitest";
import { decideAction, type ResolvedClassification } from "./decisionEngine";
import type { WorkItemRow } from "@/lib/supabase/types";

const TODAY = "2026-08-10";

function classification(overrides: Partial<ResolvedClassification> = {}): ResolvedClassification {
  return {
    relevance: "WORK",
    classification: "ACTION",
    attentionOwner: "FELIPE",
    teamOtherRelation: null,
    next_action: "Hacer algo",
    waiting_for_what: null,
    due_date: null,
    expected_date: null,
    committed_date: null,
    confidence: "HIGH",
    ...overrides,
  };
}

function workItem(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "wi-1",
    title: "Item",
    context_id: null,
    company_id: null,
    contact_id: null,
    category: null,
    status: "OPEN",
    responsible_id: null,
    next_action: null,
    waiting_for_what: null,
    waiting_for_contact_id: null,
    due_date: null,
    expected_date: null,
    committed_date: null,
    follow_up_date: null,
    postponed_until: null,
    blocking: false,
    blocking_note: null,
    estimated_minutes: null,
    last_activity_at: TODAY,
    ai_summary: null,
    ai_confidence: null,
    last_message_direction: null,
    is_demo: false,
    created_at: TODAY,
    updated_at: TODAY,
    last_reconciled_at: null,
    last_reconciled_thread_version: null,
    case_id: null,
    ...overrides,
  };
}

describe("decideAction", () => {
  it("classification=IGNORE siempre resulta en IGNORE, sin importar el resto", () => {
    const plan = decideAction({
      classification: classification({ classification: "IGNORE", next_action: null, confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("HIGH + sin Work Item existente + sin duplicados -> CREATE_WORK_ITEM", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("HIGH + sin Work Item existente + con duplicados -> REVIEW_POSSIBLE_DUPLICATE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: ["wi-2"],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_POSSIBLE_DUPLICATE");
  });

  it("MEDIUM + sin Work Item existente -> REVIEW_NEW_WORK_ITEM", () => {
    const plan = decideAction({
      classification: classification({ confidence: "MEDIUM" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });

  it("LOW + no es OUTBOUND ACTION/COMMITMENT -> IGNORE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("LOW + OUTBOUND + ACTION -> REVIEW_POTENTIAL_COMMITMENT", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW", classification: "ACTION" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("REVIEW_POTENTIAL_COMMITMENT");
  });

  it("LOW + OUTBOUND + WAITING (no es ACTION/COMMITMENT propio) -> IGNORE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW", classification: "WAITING" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("HIGH + existing + solo llena campos vacios -> UPDATE_WORK_ITEM_SAFE", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH", next_action: "Nueva accion", due_date: "2026-08-12" }),
      existingWorkItem: workItem({ next_action: null, due_date: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("UPDATE_WORK_ITEM_SAFE");
    if (plan.type === "UPDATE_WORK_ITEM_SAFE") {
      expect(plan.fieldsToFill).toContain("next_action");
      expect(plan.fieldsToFill).toContain("due_date");
    }
  });

  it("HIGH + existing + pisaria un campo ya cargado con otro valor -> REVIEW_UPDATE_WORK_ITEM (nunca se pisa solo)", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH", next_action: "Accion distinta" }),
      existingWorkItem: workItem({ next_action: "Accion original" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });

  it("MEDIUM + existing -> siempre REVIEW_UPDATE_WORK_ITEM, nunca se aplica solo", () => {
    const plan = decideAction({
      classification: classification({ confidence: "MEDIUM" }),
      existingWorkItem: workItem(),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });

  it("existing WAITING + actividad inbound nueva -> RECEIVED_CHECK, tiene prioridad sobre todo lo demas", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH", classification: "INFO", next_action: null }),
      existingWorkItem: workItem({ waiting_for_what: "Planos" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: true,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("RECEIVED_CHECK");
  });

  it("existing WAITING + actividad inbound nueva, incluso con classification=IGNORE -> sigue siendo RECEIVED_CHECK", () => {
    const plan = decideAction({
      classification: classification({ confidence: "LOW", classification: "IGNORE" }),
      existingWorkItem: workItem({ waiting_for_what: "Planos" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: true,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("RECEIVED_CHECK");
  });

  it("existing sin waiting_for_what + inbound nueva -> NO dispara RECEIVED_CHECK (nada que resolver)", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH" }),
      existingWorkItem: workItem({ waiting_for_what: null, next_action: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: true,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).not.toBe("RECEIVED_CHECK");
  });

  it("relevance=PERSONAL siempre resulta en IGNORE, incluso con confidence HIGH y classification ACTION", () => {
    const plan = decideAction({
      classification: classification({ relevance: "PERSONAL", confidence: "HIGH", classification: "ACTION" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("relevance=PERSONAL con Work Item existente tambien resulta en IGNORE (no actualiza)", () => {
    const plan = decideAction({
      classification: classification({ relevance: "PERSONAL", confidence: "HIGH" }),
      existingWorkItem: workItem(),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("relevance=UNCERTAIN + HIGH + sin existing -> REVIEW_NEW_WORK_ITEM, nunca CREATE_WORK_ITEM", () => {
    const plan = decideAction({
      classification: classification({ relevance: "UNCERTAIN", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });

  it("relevance=UNCERTAIN + HIGH + existing (llenaria campos vacios) -> REVIEW_UPDATE_WORK_ITEM, nunca UPDATE_WORK_ITEM_SAFE", () => {
    const plan = decideAction({
      classification: classification({ relevance: "UNCERTAIN", confidence: "HIGH", next_action: "Nueva accion" }),
      existingWorkItem: workItem({ next_action: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });

  it("relevance=WORK + HIGH + sin existing -> sigue siendo CREATE_WORK_ITEM (regresion)", () => {
    const plan = decideAction({
      classification: classification({ relevance: "WORK", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("HIGH + existing + nada nuevo para llenar y sin conflicto -> NO_OP, no Review", () => {
    const plan = decideAction({
      classification: classification({ confidence: "HIGH", classification: "WAITING", next_action: null, waiting_for_what: null }),
      existingWorkItem: workItem({ waiting_for_what: "Cotizacion de MBT" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("NO_OP");
  });

  it("HIGH + existing + transicion ACTION resuelta -> WAITING: limpia next_action viejo sin pasar por Review", () => {
    const plan = decideAction({
      classification: classification({
        confidence: "HIGH",
        classification: "WAITING",
        next_action: null,
        waiting_for_what: "Cotizacion de MBT",
      }),
      existingWorkItem: workItem({ next_action: "Enviar SLD a MBT", waiting_for_what: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("UPDATE_WORK_ITEM_SAFE");
    if (plan.type === "UPDATE_WORK_ITEM_SAFE") {
      expect(plan.fieldsToFill).toContain("next_action");
      expect(plan.fieldsToFill).toContain("waiting_for_what");
    }
  });

  it("HIGH + existing + waiting_for_what YA en conflicto -> la transicion ACTION->WAITING no evita Review", () => {
    const plan = decideAction({
      classification: classification({
        confidence: "HIGH",
        classification: "WAITING",
        next_action: null,
        waiting_for_what: "Nueva descripcion distinta",
      }),
      existingWorkItem: workItem({ next_action: "Enviar SLD a MBT", waiting_for_what: "Descripcion original" }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });

  it("sin existing + INFO sin next_action/waiting_for_what/committed_date -> IGNORE, no Review", () => {
    const plan = decideAction({
      classification: classification({
        confidence: "HIGH",
        classification: "INFO",
        next_action: null,
        waiting_for_what: null,
        committed_date: null,
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("sin existing + INFO pero CON next_action -> sigue el camino normal (CREATE_WORK_ITEM), no se ignora", () => {
    const plan = decideAction({
      classification: classification({
        confidence: "HIGH",
        classification: "INFO",
        next_action: "Revisar propuesta",
        waiting_for_what: null,
        committed_date: null,
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });
});

describe("ATTENTION_OWNER — nunca se auto-asigna a Felipe un trabajo que no es suyo (7 casos obligatorios del pedido)", () => {
  it("1) Inbound dirigido explicitamente a Felipe -> attentionOwner FELIPE -> se puede crear/actualizar solo", () => {
    const plan = decideAction({
      classification: classification({ classification: "ACTION", attentionOwner: "FELIPE", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("2) Inbound dirigido explicitamente a Fernando (Felipe solo en Cc) -> attentionOwner TEAM_OTHER -> nunca CREATE_WORK_ITEM, va a Review", () => {
    const plan = decideAction({
      classification: classification({ classification: "ACTION", attentionOwner: "TEAM_OTHER", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });

  it("3) Felipe delega en Fernando (is_delegation) -> classification WAITING + attentionOwner TEAM_OTHER -> nunca se auto-aplica, va a Review (nunca ACTION personal)", () => {
    const plan = decideAction({
      classification: classification({ classification: "WAITING", attentionOwner: "TEAM_OTHER", next_action: null, waiting_for_what: "Que Fernando revise el plano", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });

  it("4) Felipe promete enviar algo (OUTBOUND) -> attentionOwner FELIPE + ACTION/COMMITMENT -> se puede crear solo", () => {
    const plan = decideAction({
      classification: classification({ classification: "ACTION", attentionOwner: "FELIPE", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("5) Felipe le pide algo a un proveedor (OUTBOUND) -> attentionOwner EXTERNAL + WAITING -> se puede crear solo (Felipe es quien espera)", () => {
    const plan = decideAction({
      classification: classification({
        classification: "WAITING",
        attentionOwner: "EXTERNAL",
        next_action: null,
        waiting_for_what: "Confirmacion de tension secundaria",
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("6) Correo laboral grupal sin responsable claro -> attentionOwner SHARED o UNKNOWN -> nunca auto-crea, solo Review", () => {
    for (const owner of ["SHARED", "UNKNOWN"] as const) {
      const plan = decideAction({
        classification: classification({ classification: "ACTION", attentionOwner: owner, confidence: "HIGH" }),
        existingWorkItem: null,
        duplicateCandidateIds: [],
        hasNewInboundSinceLastSync: false,
        lastMessageIsOutbound: false,
      });
      expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
    }
  });

  it("7) Conversacion personal con accion y fecha -> relevance PERSONAL -> IGNORE, sin importar attentionOwner", () => {
    const plan = decideAction({
      classification: classification({ relevance: "PERSONAL", classification: "ACTION", attentionOwner: "FELIPE", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("8) Thread laboral existente, pero la nueva accion es de otra persona (TEAM_OTHER) -> nunca UPDATE_WORK_ITEM_SAFE/NO_OP, siempre Review", () => {
    const plan = decideAction({
      classification: classification({ classification: "ACTION", attentionOwner: "TEAM_OTHER", next_action: "Confirmar razon social", confidence: "HIGH" }),
      existingWorkItem: workItem({ next_action: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_UPDATE_WORK_ITEM");
  });
});

// Los 9 casos obligatorios del pedido "REFINAR ATTENTION OWNER SIN CONVERTIR REVIEW EN OTRA
// INBOX": items 1-8 se prueban aca (a nivel decisionEngine, que es donde vive attentionGate).
// Los items 9 y 10 (FAILED_RETRYABLE reingresa al proximo lote / una falla repetida no
// entra en loop infinito) se prueban en catchup.test.ts, donde vive esa logica.
describe("TEAM_OTHER_RELATION — refinar sin convertir Review en otra inbox (9 casos obligatorios del pedido)", () => {
  it("1) Felipe delega explicitamente en Thomas (DELEGATED_BY_FELIPE) -> AUTO WAITING/DELEGATED, nunca Review", () => {
    const plan = decideAction({
      classification: classification({
        classification: "WAITING",
        attentionOwner: "TEAM_OTHER",
        teamOtherRelation: "DELEGATED_BY_FELIPE",
        next_action: null,
        waiting_for_what: "Que Thomas envie la cotizacion",
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("1b) Delegacion explicita sobre un Work Item YA existente -> se auto-actualiza (UPDATE_WORK_ITEM_SAFE/NO_OP), nunca Review", () => {
    const plan = decideAction({
      classification: classification({
        classification: "WAITING",
        attentionOwner: "TEAM_OTHER",
        teamOtherRelation: "DELEGATED_BY_FELIPE",
        next_action: null,
        waiting_for_what: "Que Thomas envie la cotizacion",
        confidence: "HIGH",
      }),
      existingWorkItem: workItem({ next_action: "Enviar cotizacion", waiting_for_what: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: true,
    });
    expect(plan.type).toBe("UPDATE_WORK_ITEM_SAFE");
  });

  it("2) Cliente le pide algo a Thomas directamente, Felipe solo en Cc (OWNED_BY_OTHER, sin item previo) -> IGNORE silencioso, nunca Review ni CREATE", () => {
    const plan = decideAction({
      classification: classification({
        classification: "ACTION",
        attentionOwner: "TEAM_OTHER",
        teamOtherRelation: "OWNED_BY_OTHER",
        next_action: "Enviar propuesta tecnica",
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("3) Thomas responde que el se ocupa (OWNED_BY_OTHER, sobre un Work Item existente) -> NO_OP, no ACTION para Felipe, no Review", () => {
    const plan = decideAction({
      classification: classification({
        classification: "INFO",
        attentionOwner: "TEAM_OTHER",
        teamOtherRelation: "OWNED_BY_OTHER",
        next_action: null,
        confidence: "HIGH",
      }),
      existingWorkItem: workItem({ next_action: null }),
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("NO_OP");
  });

  it("4) Mail puramente FYI a un tercero (FYI_ONLY, sin item previo) -> IGNORE, nunca crea Work Item ni Review", () => {
    const plan = decideAction({
      classification: classification({
        classification: "INFO",
        attentionOwner: "TEAM_OTHER",
        teamOtherRelation: "FYI_ONLY",
        next_action: null,
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("5) El trabajo de Thomas bloquea a Felipe (BLOCKS_FELIPE) -> AUTO WAITING, nunca Review", () => {
    const plan = decideAction({
      classification: classification({
        classification: "WAITING",
        attentionOwner: "TEAM_OTHER",
        teamOtherRelation: "BLOCKS_FELIPE",
        next_action: null,
        waiting_for_what: "El precio que Thomas tiene que mandar antes de poder cerrar la oferta",
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("6) Pedido conjunto con obligacion explicita de Felipe -> attentionOwner FELIPE (no SHARED) -> ACTION auto, nunca Review", () => {
    const plan = decideAction({
      classification: classification({
        classification: "ACTION",
        attentionOwner: "FELIPE",
        next_action: "Confirmar el plazo de entrega",
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("CREATE_WORK_ITEM");
  });

  it("7) Pedido grupal generico sin responsable ('Equipo, necesitamos resolver esto hoy') -> SHARED -> Review, no se inventa responsable", () => {
    const plan = decideAction({
      classification: classification({ classification: "ACTION", attentionOwner: "SHARED", confidence: "HIGH" }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });

  it("8) Personal con accion y fecha ('Pagá el trámite antes del viernes') -> relevance PERSONAL -> IGNORE, sin evidencia laboral positiva no es WORK", () => {
    const plan = decideAction({
      classification: classification({
        relevance: "PERSONAL",
        classification: "ACTION",
        attentionOwner: "FELIPE",
        next_action: "Pagar el tramite antes del viernes",
        due_date: "2026-08-14",
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("IGNORE");
  });

  it("AMBIGUOUS (no se puede determinar si es delegacion/FYI/bloqueo) -> Review, la excepcion y no la regla", () => {
    const plan = decideAction({
      classification: classification({
        classification: "ACTION",
        attentionOwner: "TEAM_OTHER",
        teamOtherRelation: "AMBIGUOUS",
        confidence: "HIGH",
      }),
      existingWorkItem: null,
      duplicateCandidateIds: [],
      hasNewInboundSinceLastSync: false,
      lastMessageIsOutbound: false,
    });
    expect(plan.type).toBe("REVIEW_NEW_WORK_ITEM");
  });
});

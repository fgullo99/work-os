import type { InternalTeamMember } from "./teamMembers";

/** Un evento chronologico de la historia de un Case — deliberadamente mas simple que
 * CaseSourceLinkRow (que es la forma persistida en DB): esto es solo lo que hace falta para
 * armar el texto que lee el AI Case Analyzer. La capa que arma esto a partir de
 * case_source_link real (Fase 2, caseContextWindow.ts) es un mapeo directo. */
export interface CaseHistoryEntry {
  occurredAt: string; // ISO
  sourceType: string; // GMAIL | WHATSAPP | MANUAL | ...
  direction: "INBOUND" | "OUTBOUND" | null;
  from: string;
  to?: string[];
  cc?: string[];
  text: string;
}

export interface ExistingCaseSummary {
  currentState: string;
  currentOwner: string;
  nextAction: string | null;
  waitingFor: string | null;
}

/**
 * Arma el texto cronologico COMPLETO de un Case (item 8: la IA nunca analiza eventos
 * aislados) — quien escribio, To/Cc, direccion, fecha, mensaje, fuente, en orden, mas el
 * roster interno (item 30) y el estado ya registrado si el Case ya existia (para que la IA
 * entienda que esta actualizando, no arrancando de cero).
 */
export function buildCaseHistoryText(
  caseTitle: string,
  referenceLabel: string | null,
  entries: CaseHistoryEntry[],
  internalTeamMembers: InternalTeamMember[],
  existing: ExistingCaseSummary | null = null
): string {
  const lines: string[] = [];
  lines.push(`Case: ${caseTitle}`);
  if (referenceLabel) lines.push(`Referencia: ${referenceLabel}`);
  if (internalTeamMembers.length > 0) {
    lines.push(`Equipo interno de TMC (accion de estas personas = accion del equipo, no de Felipe salvo que se indique lo contrario): ${internalTeamMembers.map((m) => `${m.name} <${m.email}>`).join(", ")}`);
  }
  lines.push("");

  const sorted = [...entries].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  for (const entry of sorted) {
    const header = `--- ${entry.sourceType}${entry.direction ? ` ${entry.direction}` : ""} — ${entry.occurredAt} ---`;
    lines.push(header);
    lines.push(`De: ${entry.from}`);
    if (entry.to?.length) lines.push(`Para: ${entry.to.join(", ")}`);
    if (entry.cc?.length) lines.push(`Cc: ${entry.cc.join(", ")}`);
    lines.push(entry.text.trim());
    lines.push("");
  }

  if (existing) {
    lines.push("--- ESTADO ACTUAL YA REGISTRADO PARA ESTE CASE (antes del evento nuevo de arriba) ---");
    lines.push(`current_state: ${existing.currentState}, current_owner: ${existing.currentOwner}`);
    lines.push(`next_action: ${existing.nextAction ?? "(ninguna)"}, waiting_for: ${existing.waitingFor ?? "(nada)"}`);
  }

  return lines.join("\n");
}

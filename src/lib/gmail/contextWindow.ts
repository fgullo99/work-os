import type { ExistingWorkItemSummary, NormalizedThread } from "./types";

/**
 * Estrategia de truncado deliberadamente simple para V1: los ultimos N mensajes del
 * thread (suficiente para la gran mayoria de conversaciones comerciales/tecnicas reales,
 * que rara vez superan un puñado de idas y vueltas) + el estado del Work Item existente
 * si ya hay uno asociado. No se intenta detectar "mensajes con compromisos previos" mas
 * atras en el thread con heuristicas de texto — es una mejora razonable para una
 * iteracion futura si en el uso real aparecen threads largos donde esto importe.
 */
const MAX_MESSAGES_IN_CONTEXT = 8;

export function buildThreadContextText(thread: NormalizedThread, existingWorkItem: ExistingWorkItemSummary | null): string {
  const relevantMessages = thread.messages.slice(-MAX_MESSAGES_IN_CONTEXT);
  const omitted = thread.messages.length - relevantMessages.length;

  const lines: string[] = [];
  lines.push(`Asunto del thread: ${thread.subject}`);
  if (omitted > 0) {
    lines.push(`(se omiten ${omitted} mensaje(s) mas antiguos del thread por longitud)`);
  }
  lines.push("");

  for (const m of relevantMessages) {
    const who = m.fromName ? `${m.fromName} <${m.from}>` : m.from;
    lines.push(`--- Mensaje ${m.direction} de ${who} — ${m.date} ---`);
    lines.push(m.bodyText.trim() || m.snippet);
    lines.push("");
  }

  if (existingWorkItem) {
    lines.push("--- ESTADO ACTUAL DEL WORK ITEM YA ASOCIADO A ESTE THREAD ---");
    lines.push(`Titulo: ${existingWorkItem.title}`);
    lines.push(`Status: ${existingWorkItem.status}`);
    lines.push(`Next action actual: ${existingWorkItem.next_action ?? "(ninguna)"}`);
    lines.push(`Waiting for actual: ${existingWorkItem.waiting_for_what ?? "(nada)"}`);
    lines.push(`Expected date actual: ${existingWorkItem.expected_date ?? "(sin fecha)"}`);
    lines.push(`Due date actual: ${existingWorkItem.due_date ?? "(sin fecha)"}`);
    lines.push(`Committed date actual: ${existingWorkItem.committed_date ?? "(sin fecha)"}`);
  }

  return lines.join("\n");
}

import type { ExistingWorkItemSummary, NormalizedMessage, NormalizedThread } from "./types";

/**
 * Seleccion adaptativa de contexto (reemplaza el truncado fijo a los ultimos N mensajes):
 * para threads largos o historicos (Backlog Recovery), el pedido original puede estar lejos
 * del final y un truncado ciego lo pierde. Se incluyen: el primer mensaje del thread
 * (origen del pedido), los ultimos MAX_RECENT_MESSAGES, y el ultimo INBOUND/ultimo OUTBOUND
 * aunque caigan fuera de esa ventana — asi el modelo siempre ve como empezo el asunto y como
 * esta AHORA, sin mandar el thread completo. Deliberadamente no se intenta detectar con
 * heuristicas de texto "el mensaje donde se pidio/prometio algo" mas atras en el thread —
 * el primer mensaje + ultimo INBOUND/OUTBOUND ya cubren el caso comercial tipico.
 */
const MAX_RECENT_MESSAGES = 10;

function selectAdaptiveContext(messages: NormalizedMessage[]): NormalizedMessage[] {
  if (messages.length <= MAX_RECENT_MESSAGES) return messages;

  const selected = new Set<number>();
  selected.add(0); // primer mensaje del thread: contexto de origen del pedido
  for (let i = Math.max(0, messages.length - MAX_RECENT_MESSAGES); i < messages.length; i++) {
    selected.add(i);
  }
  const lastInboundIdx = findLastIndex(messages, (m) => m.direction === "INBOUND");
  if (lastInboundIdx !== -1) selected.add(lastInboundIdx);
  const lastOutboundIdx = findLastIndex(messages, (m) => m.direction === "OUTBOUND");
  if (lastOutboundIdx !== -1) selected.add(lastOutboundIdx);

  return Array.from(selected)
    .sort((a, b) => a - b)
    .map((i) => messages[i])
    .filter((m): m is NormalizedMessage => m !== undefined);
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

export function buildThreadContextText(
  thread: NormalizedThread,
  existingWorkItem: ExistingWorkItemSummary | null,
  userAddresses: string[] = []
): string {
  const relevantMessages = selectAdaptiveContext(thread.messages);
  const omitted = thread.messages.length - relevantMessages.length;

  const lines: string[] = [];
  lines.push(`Asunto del thread: ${thread.subject}`);
  if (userAddresses.length > 0) {
    lines.push(`Cuenta conectada (direccion del usuario): ${userAddresses.join(", ")}`);
  }
  if (omitted > 0) {
    lines.push(`(se omiten ${omitted} mensaje(s) intermedios del thread por longitud — se muestra el primer mensaje, los mas recientes, y el ultimo de cada direccion)`);
  }
  lines.push("");

  for (const m of relevantMessages) {
    const who = m.fromName ? `${m.fromName} <${m.from}>` : m.from;
    lines.push(`--- Mensaje ${m.direction} de ${who} — ${m.date} ---`);
    lines.push(`To: ${m.to.length > 0 ? m.to.join(", ") : "(sin destinatarios visibles)"}`);
    if (m.cc.length > 0) lines.push(`Cc: ${m.cc.join(", ")}`);
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

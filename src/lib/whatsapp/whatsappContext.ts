import type { ZapiaConversationUnit } from "./zapiaSchema";
import type { ExistingWorkItemSummary } from "@/lib/gmail/types";

/** Arma el texto que se le manda al Normalizer: toda la conversacion (Zapia ya la manda
 * acotada, no hace falta truncar como en Gmail) + el Work Item existente relacionado, si
 * hay uno (mismo contacto/empresa — ver zapiaMatch.ts). */
export function buildWhatsAppContextText(
  unit: ZapiaConversationUnit,
  existingWorkItem: ExistingWorkItemSummary | null
): string {
  const lines: string[] = [];
  const who = unit.conversation.contact_name ?? unit.conversation.chat_name ?? "contacto sin nombre";
  lines.push(`Conversacion de WhatsApp con: ${who}`);
  if (unit.conversation.phone) lines.push(`Telefono: ${unit.conversation.phone}`);
  lines.push("");

  for (const m of unit.messages) {
    const label = m.direction === "inbound" ? "INBOUND" : m.direction === "outbound" ? "OUTBOUND" : "UNKNOWN";
    lines.push(`--- Mensaje ${label}${m.sent_at ? ` — ${m.sent_at}` : ""} ---`);
    lines.push(m.text.trim());
    lines.push("");
  }

  if (existingWorkItem) {
    lines.push("--- CONTEXTO: WORK ITEM EXISTENTE RELACIONADO (mismo contacto/empresa) ---");
    lines.push(`Titulo: ${existingWorkItem.title}`);
    lines.push(`Status: ${existingWorkItem.status}`);
    lines.push(`Next action actual: ${existingWorkItem.next_action ?? "(ninguna)"}`);
    lines.push(`Waiting for actual: ${existingWorkItem.waiting_for_what ?? "(nada)"}`);
    lines.push(`Expected date actual: ${existingWorkItem.expected_date ?? "(sin fecha)"}`);
    lines.push(`Due date actual: ${existingWorkItem.due_date ?? "(sin fecha)"}`);
  }

  return lines.join("\n");
}

import type { SourceDirection, SourceType } from "@/lib/supabase/types";

const SOURCE_LABELS: Partial<Record<SourceType, string>> = {
  GMAIL: "Email",
  WHATSAPP: "WhatsApp",
  MANUAL: "Nota manual",
  CALENDAR: "Calendario",
  ODOO: "Odoo",
  DRIVE: "Drive",
  SLACK: "Slack",
  OTHER: "Fuente",
};

/**
 * Etiqueta corta y DETERMINISTICA para un evento del timeline de un Case (ej. "Email
 * entrante de cliente@x.com") — nunca la escribe la IA (item 38: costo cero por evento, el
 * unico resumen que gasta IA es case.last_meaningful_event/ai_summary). Se guarda en
 * case_source_link.event_label al ingerir.
 */
export function buildEventLabel(params: { sourceType: SourceType; direction: SourceDirection | null; from: string | null }): string {
  const sourceLabel = SOURCE_LABELS[params.sourceType] ?? params.sourceType;
  if (!params.direction) return sourceLabel;
  const directionLabel = params.direction === "INBOUND" ? "entrante" : "saliente";
  const suffix = params.from ? ` de ${params.from}` : "";
  return `${sourceLabel} ${directionLabel}${suffix}`;
}

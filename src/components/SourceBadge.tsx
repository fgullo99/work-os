import type { SourceType } from "@/lib/supabase/types";

const SOURCE_LABEL: Record<SourceType, string> = {
  GMAIL: "Gmail",
  WHATSAPP: "WhatsApp",
  CALENDAR: "Calendar",
  MANUAL: "Manual",
  ODOO: "Odoo",
  DRIVE: "Drive",
  SLACK: "Slack",
  OTHER: "Otro",
};

const SOURCE_DOT: Record<SourceType, string> = {
  GMAIL: "bg-accent-500",
  WHATSAPP: "bg-emerald-500",
  CALENDAR: "bg-ink-400",
  MANUAL: "bg-ink-400",
  ODOO: "bg-ink-400",
  DRIVE: "bg-ink-400",
  SLACK: "bg-ink-400",
  OTHER: "bg-ink-400",
};

export function SourceBadge({
  source,
  demo,
  via,
  className,
}: {
  source: SourceType;
  demo?: boolean;
  /** Proveedor tecnico detras de la fuente (ej. "Zapia" detras de WhatsApp). La fuente que
   * ve el usuario sigue siendo WhatsApp — esto es solo un detalle secundario. */
  via?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-medium text-ink-600 ${className ?? ""}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_DOT[source]}`} aria-hidden="true" />
      {SOURCE_LABEL[source]}
      {via && <span className="text-ink-400">&middot; via {via}</span>}
      {demo && <span className="text-ink-400">&middot; demo</span>}
    </span>
  );
}

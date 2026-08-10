import { formatRelativeEs } from "@/lib/format/date";

interface Props {
  gmailConnected: boolean;
  gmailEmail?: string | null;
  gmailLastSyncedAt?: string | null;
}

export function SourcesStatus({ gmailConnected, gmailEmail, gmailLastSyncedAt }: Props) {
  return (
    <section className="card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Fuentes</h3>
      <div className="mt-3 space-y-3">
        <SourceLine
          label="Gmail"
          connected={gmailConnected}
          detail={gmailConnected ? (gmailEmail ?? "Conectado") : "No conectado"}
          sub={gmailConnected && gmailLastSyncedAt ? `Ultima sync: ${formatRelativeEs(gmailLastSyncedAt)}` : undefined}
        />
        <SourceLine label="WhatsApp" connected={false} detail="Sin integracion" />
        <SourceLine label="Calendar" connected={false} detail="Proximamente" />
      </div>
    </section>
  );
}

function SourceLine({
  label,
  connected,
  detail,
  sub,
}: {
  label: string;
  connected: boolean;
  detail: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-ink-700">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-ink-300"}`} aria-hidden="true" />
        {label}
      </span>
      <div className="text-right">
        <p className="truncate text-xs font-medium text-ink-500">{detail}</p>
        {sub && <p className="text-[11px] text-ink-400">{sub}</p>}
      </div>
    </div>
  );
}

interface Props {
  provider: string;
  model: string;
}

/** Puramente informativo — lee la config real de AIProvider (nunca hardcodea el modelo). */
export function AiEnginePanel({ provider, model }: Props) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink-800">AI Engine</h2>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-ink-700 sm:grid-cols-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Provider</p>
          <p>{provider}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Model</p>
          <p>{model}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-500">Used for: Manual Capture, Gmail, WhatsApp (Zapia + Quick Capture).</p>
    </section>
  );
}

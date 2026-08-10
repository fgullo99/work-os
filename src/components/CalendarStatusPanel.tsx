export function CalendarStatusPanel() {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-800">Calendar</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />
          COMING SOON
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-600">Google Calendar todavia no esta integrado. Fuera de alcance de V1.</p>
    </section>
  );
}

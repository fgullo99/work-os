export function AssistantSummary({ observations }: { observations: string[] }) {
  return (
    <section className="card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">&#10022; Asistente IA</h3>
      {observations.length === 0 ? (
        <p className="mt-2 text-sm text-ink-400">Todo tranquilo por ahora.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
          {observations.map((observation, i) => (
            <li key={i}>{observation}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

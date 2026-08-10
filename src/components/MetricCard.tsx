type Tone = "neutral" | "accent" | "risk" | "waiting";

const VALUE_CLASSES: Record<Tone, string> = {
  neutral: "text-ink-900",
  accent: "text-accent-600",
  risk: "text-risk-600",
  waiting: "text-waiting-600",
};

export function MetricCard({ label, value, tone = "neutral" }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${VALUE_CLASSES[tone]}`}>{value}</p>
    </div>
  );
}

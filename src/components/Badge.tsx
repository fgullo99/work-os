import type { ReactNode } from "react";

const TONE_CLASSES: Record<string, string> = {
  action: "bg-accent-100 text-accent-600",
  waiting: "bg-waiting-100 text-waiting-600",
  blocking: "bg-risk-100 text-risk-600",
  neutral: "bg-ink-100 text-ink-600",
};

export function Badge({ tone, children }: { tone: "action" | "waiting" | "blocking" | "neutral"; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

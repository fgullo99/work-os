"use client";

import type { RiskResult } from "@/lib/engine/risk";
import type { LatestSourceInfo } from "@/lib/workItems/queries";
import type { WorkItemWithRelations } from "@/lib/workItems/types";
import { SourceBadge } from "./SourceBadge";

export function AtRiskRow({
  item,
  onEdit,
}: {
  item: WorkItemWithRelations & { risk: RiskResult; latestSource?: LatestSourceInfo | null };
  onEdit: () => void;
}) {
  const headerParts = [item.company?.name, item.context?.title].filter(Boolean) as string[];

  return (
    <div className="border-l-4 border-l-risk-600 py-3 pl-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {headerParts.length > 0 && (
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {headerParts.join(" · ")}
            </p>
          )}
          <button type="button" onClick={onEdit} className="text-left text-sm font-semibold text-ink-900 hover:text-accent-600">
            {item.title}
          </button>
          <p className="mt-0.5 text-xs font-medium text-risk-600">{item.risk.reasons.join(" · ")}</p>
        </div>
        {item.latestSource && (
          <SourceBadge
            source={item.latestSource.source_type}
            via={item.latestSource.via}
            demo={item.is_demo}
            className="shrink-0"
          />
        )}
      </div>
    </div>
  );
}

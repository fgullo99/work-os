"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CaseRow, CompanyRow, ContactRow, ContextRow } from "@/lib/supabase/types";
import type { WorkItemWithRelations } from "@/lib/workItems/types";
import { formatDateShortEs } from "@/lib/format/date";
import { AppShell } from "./AppShell";
import { WorkItemDetailSheet } from "./WorkItemDetailSheet";
import { CaseCard } from "./CaseCard";
import { CaseDetailDrawer } from "./CaseDetailDrawer";

interface Props {
  initialQuery: string;
  results: WorkItemWithRelations[];
  cases: CaseRow[];
  companies: CompanyRow[];
  contacts: ContactRow[];
  contexts: ContextRow[];
  todayISO: string;
  userFirstName: string;
  gmailConnected: boolean;
  gmailEmail: string | null;
}

export function SearchClient({
  initialQuery,
  results,
  cases,
  companies,
  contacts,
  contexts,
  todayISO,
  userFirstName,
  gmailConnected,
  gmailEmail,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailCaseId, setDetailCaseId] = useState<string | null>(null);
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <AppShell userFirstName={userFirstName} gmailConnected={gmailConnected} gmailEmail={gmailEmail}>
      <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-ink-900">Search</h1>

      <form onSubmit={handleSubmit} className="mt-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por titulo, empresa, contacto, context..."
          className="input"
          autoFocus
        />
      </form>

      {cases.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Cases</h2>
          <div className="space-y-2">
            {cases.map((c) => (
              <CaseCard key={c.id} caseRow={c} companyName={c.company_id ? companyNameById.get(c.company_id) : null} onOpen={() => setDetailCaseId(c.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 space-y-2">
        {results.length === 0 && cases.length === 0 && <p className="text-sm text-ink-400">Sin resultados.</p>}
        {results.length > 0 && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Work Items (legacy)</h2>}
        {results.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setDetailId(item.id)}
            className="card block w-full p-4 text-left"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {item.company?.name ?? item.context?.title ?? "Sin empresa"}
                </p>
                <p className="text-sm font-semibold text-ink-900">{item.title}</p>
                {item.next_action && <p className="text-sm text-ink-600">{item.next_action}</p>}
                {item.waiting_for_what && <p className="text-sm text-waiting-600">Esperando: {item.waiting_for_what}</p>}
              </div>
              <div className="shrink-0 text-right">
                <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
                  {item.status}
                </span>
                {item.due_date && <p className="mt-1 text-xs text-ink-400">{formatDateShortEs(item.due_date)}</p>}
              </div>
            </div>
          </button>
        ))}
      </div>

      <WorkItemDetailSheet
        workItemId={detailId}
        onClose={() => setDetailId(null)}
        companies={companies}
        contacts={contacts}
        contexts={contexts}
        todayISO={todayISO}
      />

      <CaseDetailDrawer caseId={detailCaseId} onClose={() => setDetailCaseId(null)} />
      </div>
    </AppShell>
  );
}

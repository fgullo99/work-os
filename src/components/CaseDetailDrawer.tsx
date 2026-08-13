"use client";

import { useEffect, useState } from "react";
import type { CaseCurrentOwner, CaseCurrentState, CaseRow, CaseSourceLinkRow } from "@/lib/supabase/types";
import { formatDateShortEs, formatRelativeEs } from "@/lib/format/date";
import { Badge } from "./Badge";
import { useToast } from "./Toast";

interface Props {
  caseId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

const STATE_OPTIONS: { value: CaseCurrentState; label: string }[] = [
  { value: "ACTION_ME", label: "Accion mia" },
  { value: "WAITING_EXTERNAL", label: "Esperando externo" },
  { value: "DELEGATED_INTERNAL", label: "Delegado interno" },
  { value: "BLOCKED", label: "En riesgo" },
  { value: "NO_ACTION", label: "Sin accion" },
  { value: "CLOSED", label: "Cerrado" },
  { value: "REVIEW", label: "En revision" },
];

const OWNER_OPTIONS: { value: CaseCurrentOwner; label: string }[] = [
  { value: "FELIPE", label: "Vos" },
  { value: "TEAM", label: "Equipo" },
  { value: "EXTERNAL", label: "Externo" },
  { value: "NONE", label: "Nadie" },
  { value: "UNKNOWN", label: "Sin definir" },
];

function gmailUrl(source: CaseSourceLinkRow): string | null {
  if (source.source_type !== "GMAIL") return source.external_url;
  if (source.external_url) return source.external_url;
  if (source.external_id) return `https://mail.google.com/mail/u/0/#all/${source.external_id}`;
  return null;
}

/** Drawer de detalle de un Case (item 22) — a diferencia de WorkItemDetailSheet, es
 * deliberadamente mas simple: sin autosave debounced campo por campo, solo estado/owner
 * editables (item 36) + timeline de solo lectura. Corte consciente de alcance (ver plan,
 * "Corte si el tiempo aprieta"). */
export function CaseDetailDrawer({ caseId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [sources, setSources] = useState<CaseSourceLinkRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!caseId) {
      setCaseRow(null);
      setSources([]);
      return;
    }
    setLoading(true);
    fetch(`/api/cases/${caseId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setCaseRow(data.case);
          setSources(data.sources ?? []);
        } else {
          toast.show("No se pudo cargar el Case.");
        }
      })
      .catch((err) => {
        console.error("[case-detail] fetch fallo:", err);
        toast.show("No se pudo cargar el Case.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function patch(fields: Partial<Pick<CaseRow, "current_state" | "current_owner">>) {
    if (!caseRow) return;
    const prev = caseRow;
    setCaseRow({ ...caseRow, ...fields });
    setSaving(true);
    try {
      const res = await fetch(`/api/cases/${caseRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      onChanged?.();
    } catch (err) {
      console.error("[case-detail] patch fallo:", err);
      setCaseRow(prev);
      toast.show("No se pudo guardar el cambio.");
    } finally {
      setSaving(false);
    }
  }

  const distinctSources = Array.from(
    new Map(sources.filter((s) => s.source_type === "GMAIL" && s.external_id).map((s) => [s.external_id, s])).values()
  );

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity ${caseId ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
      aria-hidden={!caseId}
    >
      <div className="absolute inset-0 bg-ink-950/10" onClick={onClose} />
      <div
        className={`absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-popover transition-transform duration-200 ${
          caseId ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex-1 overflow-y-auto p-6">
          {loading || !caseRow ? (
            <p className="py-10 text-center text-sm text-ink-400">Cargando...</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-lg font-semibold text-ink-900">{caseRow.title}</p>
                <button type="button" onClick={onClose} className="btn-ghost shrink-0">
                  Cerrar
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                {caseRow.reference_value && (
                  <span>
                    {caseRow.reference_type ? `${caseRow.reference_type} ` : ""}
                    {caseRow.reference_value}
                  </span>
                )}
                {saving && <span>Guardando...</span>}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Estado</label>
                  <select
                    value={caseRow.current_state}
                    onChange={(e) => patch({ current_state: e.target.value as CaseCurrentState })}
                    className="input"
                  >
                    {STATE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Owner</label>
                  <select
                    value={caseRow.current_owner}
                    onChange={(e) => patch({ current_owner: e.target.value as CaseCurrentOwner })}
                    className="input"
                  >
                    {OWNER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {caseRow.risk === "AT_RISK" && (
                <div className="mt-3">
                  <Badge tone="blocking">EN RIESGO</Badge>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-accent-100 bg-accent-50 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-600">Accion</p>
                  <p className="text-sm text-ink-700">{caseRow.next_action ?? "Sin accion"}</p>
                  {caseRow.due_date && <p className="mt-1 text-xs text-ink-500">Vence {formatDateShortEs(caseRow.due_date)}</p>}
                </div>
                <div className="rounded-lg border border-waiting-100 bg-waiting-100/40 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-waiting-600">Esperando</p>
                  <p className="text-sm text-ink-700">{caseRow.waiting_for ?? "Sin espera"}</p>
                  {caseRow.expected_date && <p className="mt-1 text-xs text-ink-500">Esperado {formatDateShortEs(caseRow.expected_date)}</p>}
                </div>
              </div>

              {caseRow.responsible && (
                <p className="mt-3 text-sm text-ink-600">
                  Responsable interno: <span className="font-medium text-ink-800">{caseRow.responsible}</span>
                </p>
              )}

              {caseRow.ai_summary && (
                <div className="mt-4 rounded-lg bg-ink-50 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Resumen</p>
                  <p className="text-sm text-ink-700">{caseRow.ai_summary}</p>
                </div>
              )}

              <div className="mt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Timeline</p>
                <div className="flex flex-col gap-3 border-l-2 border-ink-100 pl-4">
                  {sources.map((s) => (
                    <div key={s.id}>
                      <p className="text-xs text-ink-400">
                        {formatDateShortEs(s.occurred_at.slice(0, 10))} · {formatRelativeEs(s.occurred_at)}
                      </p>
                      <p className="text-sm font-medium text-ink-800">{s.event_label ?? s.source_type}</p>
                      {s.raw_excerpt && <p className="text-sm text-ink-600">{s.raw_excerpt}</p>}
                    </div>
                  ))}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Ahora</p>
                    <p className="text-sm text-ink-800">{caseRow.last_meaningful_event ?? "Sin eventos"}</p>
                  </div>
                </div>
              </div>

              {distinctSources.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Fuentes</p>
                  <div className="flex flex-col gap-1.5">
                    {distinctSources.map((s) => {
                      const url = gmailUrl(s);
                      return (
                        <a
                          key={s.id}
                          href={url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-sm ${url ? "text-accent-600 hover:underline" : "pointer-events-none text-ink-300"}`}
                        >
                          Abrir en Gmail — {formatDateShortEs(s.occurred_at.slice(0, 10))}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

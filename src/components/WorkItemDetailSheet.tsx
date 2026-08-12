"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyRow, ContactRow, ContextRow, WorkItemCategory } from "@/lib/supabase/types";
import type { WorkItemWithRelations } from "@/lib/workItems/types";
import { computePriority } from "@/lib/engine/priority";
import { DatePickerModal } from "./DatePickerModal";
import { DelegateModal } from "./DelegateModal";
import { Badge } from "./Badge";
import { useToast } from "./Toast";

interface SourceLink {
  id: string;
  source_type: string;
  raw_excerpt: string | null;
  external_url: string | null;
  occurred_at: string;
}

interface NoteRow {
  id: string;
  body: string;
  created_at: string;
}

interface AiActionRow {
  id: string;
  source_type: "GMAIL" | "WHATSAPP";
  action: "CREATE" | "UPDATE";
  confidence: string;
  reasoning: string | null;
  changed_fields: string[];
  created_at: string;
  undone_at: string | null;
}

interface Props {
  workItemId: string | null;
  onClose: () => void;
  companies: CompanyRow[];
  contacts: ContactRow[];
  contexts: ContextRow[];
  todayISO: string;
}

const CATEGORY_OPTIONS: { value: WorkItemCategory | ""; label: string }[] = [
  { value: "", label: "Sin categoria" },
  { value: "COMERCIAL", label: "Comercial" },
  { value: "TECNICO", label: "Tecnico" },
  { value: "OPERACIONES", label: "Operaciones" },
  { value: "ADMINISTRATIVO", label: "Administrativo" },
];

const ESTIMATED_OPTIONS = [5, 15, 30, 60] as const;
const AUTOSAVE_DEBOUNCE_MS = 700;

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function WorkItemDetailSheet({ workItemId, onClose, companies, contacts, contexts, todayISO }: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<WorkItemWithRelations | null>(null);
  const [sources, setSources] = useState<SourceLink[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [aiActions, setAiActions] = useState<AiActionRow[]>([]);
  const [noteText, setNoteText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [datePickerFor, setDatePickerFor] = useState<null | "postpone">(null);
  const [delegateOpen, setDelegateOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!workItemId) {
      setItem(null);
      return;
    }
    setLoading(true);
    setSaveStatus("idle");
    fetch(`/api/work-items/${workItemId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setItem(data.workItem);
          setSources(data.sources ?? []);
          setNotes(data.notes ?? []);
          setAiActions(data.aiActions ?? []);
        }
      })
      .finally(() => setLoading(false));
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [workItemId]);

  if (!workItemId) return null;

  /** Guarda en el servidor sin esperar respuesta para que el usuario siga trabajando —
   * el indicador Saving/Saved/Error es la unica señal, nunca bloquea la edicion. */
  async function persist(fields: Partial<WorkItemWithRelations>) {
    if (!item) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/work-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      if (data.ok) setSaveStatus("saved");
      else throw new Error("update_failed");
    } catch (err) {
      console.error("[work-item-detail] autosave fallo:", err);
      setSaveStatus("error");
      toast.show("No se pudo guardar el cambio. Reintentá.");
    }
  }

  /** Autosave con debounce para campos de texto libre (title/next_action/waiting_for_what) —
   * el estado local ya cambio al toque (update()), esto solo dispara el PATCH diferido. */
  function scheduleAutosave(fields: Partial<WorkItemWithRelations>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(fields), AUTOSAVE_DEBOUNCE_MS);
  }

  function update<K extends keyof WorkItemWithRelations>(key: K, value: WorkItemWithRelations[K], debounced: boolean) {
    setItem((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (debounced) scheduleAutosave({ [key]: value } as Partial<WorkItemWithRelations>);
    else persist({ [key]: value } as Partial<WorkItemWithRelations>);
  }

  /** Acciones (Done/Postpone/Delegate/Received/Reopen/Ignore): optimistic — cierra el drawer
   * al toque (la card en la lista de atras se va a resincronizar la proxima vez que el
   * servidor mande props nuevas), dispara el POST en paralelo, y si falla avisa por toast
   * sin poder revertir el cierre (el usuario puede reabrir el item y reintentar). */
  async function runAction(path: string, body?: Record<string, unknown>) {
    if (!item) return;
    const id = item.id;
    setBusy(true);
    onClose();
    try {
      const res = await fetch(`/api/work-items/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      console.error(`[work-item-detail] accion ${path} fallo:`, err);
      toast.show("No se pudo aplicar la accion. Abrí el item de nuevo para reintentar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote() {
    if (!item || !noteText.trim()) return;
    const text = noteText.trim();
    setNotes((prev) => [{ id: crypto.randomUUID(), body: text, created_at: new Date().toISOString() }, ...prev]);
    setNoteText("");
    try {
      const res = await fetch(`/api/work-items/${item.id}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      console.error("[work-item-detail] agregar nota fallo:", err);
      toast.show("No se pudo guardar la nota.");
    }
  }

  const priority = item ? computePriority(item, { todayISO, contactTier: item.contact?.tier ?? null }) : null;

  return (
    <>
      {/* Panel lateral deslizante: el Dashboard queda visible detras (overlay liviano, no
          bloquea la vista), a diferencia del modal centrado que tapaba todo antes. */}
      <div
        className={`fixed inset-0 z-50 transition-opacity ${workItemId ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        aria-hidden={!workItemId}
      >
        <div className="absolute inset-0 bg-ink-950/10" onClick={onClose} />
        <div
          className={`absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-popover transition-transform duration-200 ${
            workItemId ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex-1 overflow-y-auto p-6">
            {loading || !item ? (
              <p className="py-10 text-center text-sm text-ink-400">Cargando...</p>
            ) : (
              <>
                {/* --- Bloque principal: lo que pediste ver primero --- */}
                <div className="flex items-start justify-between gap-3">
                  <input
                    value={item.title}
                    onChange={(e) => update("title", e.target.value, true)}
                    className="w-full border-none bg-transparent text-lg font-semibold text-ink-900 outline-none"
                  />
                  <button type="button" onClick={onClose} className="btn-ghost shrink-0">
                    Cerrar
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                  <SaveIndicator status={saveStatus} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">{item.status}</span>
                  {priority && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        priority.bucket === "DO_NOW"
                          ? "bg-risk-100 text-risk-600"
                          : priority.bucket === "TODAY"
                            ? "bg-accent-100 text-accent-600"
                            : "bg-ink-100 text-ink-500"
                      }`}
                      title={priority.why}
                    >
                      {priority.bucket.replace("_", " ")}
                    </span>
                  )}
                  {item.blocking && <Badge tone="blocking">BLOCKING</Badge>}
                </div>
                {priority && <p className="mt-1 text-xs text-ink-500">{priority.why}</p>}

                <div className="mt-4">
                  <label className="label">Responsible</label>
                  <select
                    value={item.responsible_id ?? ""}
                    onChange={(e) => update("responsible_id", e.target.value || null, false)}
                    className="input"
                  >
                    <option value="">Sin asignar (vos)</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-accent-100 bg-accent-50 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-600">Action</p>
                    <input
                      value={item.next_action ?? ""}
                      onChange={(e) => update("next_action", e.target.value || null, true)}
                      placeholder="Sin accion"
                      className="input"
                    />
                    <div className="mt-2">
                      <label className="label">Vence</label>
                      <input
                        type="date"
                        value={item.due_date ?? ""}
                        onChange={(e) => update("due_date", e.target.value || null, false)}
                        className="input"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-waiting-100 bg-waiting-100/40 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-waiting-600">Waiting</p>
                    <input
                      value={item.waiting_for_what ?? ""}
                      onChange={(e) => update("waiting_for_what", e.target.value || null, true)}
                      placeholder="Sin espera"
                      className="input"
                    />
                    <div className="mt-2">
                      <label className="label">Esperado</label>
                      <input
                        type="date"
                        value={item.expected_date ?? ""}
                        onChange={(e) => update("expected_date", e.target.value || null, false)}
                        className="input"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2 border-y border-ink-100 py-4">
                  <button type="button" disabled={busy} className="btn-secondary" onClick={() => runAction("done")}>
                    Done
                  </button>
                  <button type="button" disabled={busy} className="btn-secondary" onClick={() => setDatePickerFor("postpone")}>
                    Postpone
                  </button>
                  <button type="button" disabled={busy} className="btn-secondary" onClick={() => setDelegateOpen(true)}>
                    Delegate
                  </button>
                  {item.waiting_for_what && (
                    <button type="button" disabled={busy} className="btn-secondary" onClick={() => runAction("received")}>
                      Received
                    </button>
                  )}
                  {(item.status === "DONE" || item.status === "IGNORED") && (
                    <button type="button" disabled={busy} className="btn-secondary" onClick={() => runAction("reopen")}>
                      Reopen
                    </button>
                  )}
                  <button type="button" disabled={busy} className="btn-ghost" onClick={() => runAction("ignore")}>
                    Ignore
                  </button>
                </div>

                {/* --- Bloque secundario: contexto, fuente, notas, IA, actividad --- */}
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Empresa</label>
                    <select
                      value={item.company_id ?? ""}
                      onChange={(e) => update("company_id", e.target.value || null, false)}
                      className="input"
                    >
                      <option value="">Sin empresa</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Context</label>
                    <select
                      value={item.context_id ?? ""}
                      onChange={(e) => update("context_id", e.target.value || null, false)}
                      className="input"
                    >
                      <option value="">Sin context</option>
                      {contexts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Categoria</label>
                    <select
                      value={item.category ?? ""}
                      onChange={(e) => update("category", (e.target.value || null) as WorkItemCategory | null, false)}
                      className="input"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Tiempo estimado</label>
                    <div className="flex gap-1.5">
                      {ESTIMATED_OPTIONS.map((m) => (
                        <button
                          type="button"
                          key={m}
                          onClick={() => update("estimated_minutes", item.estimated_minutes === m ? null : m, false)}
                          className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                            item.estimated_minutes === m
                              ? "border-accent-500 bg-accent-500 text-white"
                              : "border-ink-200 text-ink-600"
                          }`}
                        >
                          {m}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="flex items-center gap-2 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      checked={item.blocking}
                      onChange={(e) => update("blocking", e.target.checked, false)}
                    />
                    Esto bloquea otra actividad
                  </label>
                  {item.blocking && (
                    <input
                      value={item.blocking_note ?? ""}
                      onChange={(e) => update("blocking_note", e.target.value || null, true)}
                      placeholder="Que bloquea?"
                      className="input mt-2"
                    />
                  )}
                </div>

                {sources.length > 0 && (
                  <div className="mt-4">
                    <p className="label">Fuentes / Evidencia</p>
                    {sources.map((s) => (
                      <div key={s.id} className="mt-1 rounded-md bg-ink-50 p-3 text-sm text-ink-600">
                        {s.raw_excerpt && <p className="italic">&quot;{s.raw_excerpt}&quot;</p>}
                        {s.source_type === "GMAIL" && s.external_url && (
                          <a
                            href={s.external_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-xs font-medium text-accent-600 hover:underline"
                          >
                            Ver original
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {item.ai_summary && (
                  <div className="mt-4">
                    <p className="label">AI reasoning</p>
                    <p className="rounded-md bg-ink-50 p-3 text-sm text-ink-600">
                      {item.ai_summary}
                      {item.ai_confidence && <span className="ml-2 text-xs text-ink-400">({item.ai_confidence})</span>}
                    </p>
                  </div>
                )}

                <div className="mt-4">
                  <p className="label">Notas</p>
                  <div className="flex gap-2">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Agregar una nota..."
                      className="input"
                      onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                    />
                    <button type="button" className="btn-secondary" onClick={handleAddNote}>
                      Agregar
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {notes.map((n) => (
                      <div key={n.id} className="rounded-md border border-ink-100 p-2 text-sm text-ink-700">
                        {n.body}
                      </div>
                    ))}
                  </div>
                </div>

                {aiActions.length > 0 && (
                  <div className="mt-4">
                    <p className="label">Activity</p>
                    <div className="space-y-1.5">
                      {aiActions.map((a) => (
                        <div key={a.id} className="text-xs text-ink-500">
                          <span className="font-medium text-ink-700">{a.action === "CREATE" ? "AI creó" : "AI actualizó"}</span>{" "}
                          · {a.source_type} · {a.confidence}
                          {a.undone_at && <span className="ml-1 text-risk-600">(deshecho)</span>}
                          {a.reasoning && <p className="mt-0.5 italic text-ink-400">{a.reasoning}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <DatePickerModal
        open={datePickerFor === "postpone"}
        title="Postpone"
        todayISO={todayISO}
        onClose={() => setDatePickerFor(null)}
        onConfirm={(dateISO) => {
          setDatePickerFor(null);
          runAction("postpone", { until: dateISO });
        }}
      />

      <DelegateModal
        open={delegateOpen}
        contacts={contacts}
        todayISO={todayISO}
        onClose={() => setDelegateOpen(false)}
        onConfirm={(responsibleId, expectedDateISO) => {
          setDelegateOpen(false);
          runAction("delegate", { responsible_id: responsibleId, expected_date: expectedDateISO });
        }}
      />
    </>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") return <span>Saving…</span>;
  if (status === "saved") return <span className="text-accent-600">Saved</span>;
  if (status === "error") return <span className="text-risk-600">Error al guardar</span>;
  return null;
}

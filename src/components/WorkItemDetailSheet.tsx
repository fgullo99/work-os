"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyRow, ContactRow, ContextRow, WorkItemCategory, WorkItemRow } from "@/lib/supabase/types";
import { Modal } from "./Modal";
import { DatePickerModal } from "./DatePickerModal";
import { DelegateModal } from "./DelegateModal";

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

export function WorkItemDetailSheet({ workItemId, onClose, companies, contacts, contexts, todayISO }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<WorkItemRow | null>(null);
  const [sources, setSources] = useState<SourceLink[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [datePickerFor, setDatePickerFor] = useState<null | "postpone">(null);
  const [delegateOpen, setDelegateOpen] = useState(false);

  useEffect(() => {
    if (!workItemId) {
      setItem(null);
      return;
    }
    setLoading(true);
    fetch(`/api/work-items/${workItemId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setItem(data.workItem);
          setSources(data.sources ?? []);
          setNotes(data.notes ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [workItemId]);

  if (!workItemId) return null;

  function update<K extends keyof WorkItemRow>(key: K, value: WorkItemRow[K]) {
    setItem((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function patch(fields: Partial<WorkItemRow>) {
    if (!item) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/work-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (data.ok) setItem(data.workItem);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function runAction(path: string, body?: Record<string, unknown>) {
    if (!item) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/work-items/${item.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (data.ok && data.workItem) setItem(data.workItem);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdits() {
    if (!item) return;
    await patch({
      title: item.title,
      next_action: item.next_action,
      waiting_for_what: item.waiting_for_what,
      due_date: item.due_date,
      expected_date: item.expected_date,
      committed_date: item.committed_date,
      company_id: item.company_id,
      context_id: item.context_id,
      category: item.category,
      blocking: item.blocking,
      blocking_note: item.blocking_note,
      estimated_minutes: item.estimated_minutes,
    });
  }

  async function handleAddNote() {
    if (!item || !noteText.trim()) return;
    const res = await fetch(`/api/work-items/${item.id}/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteText.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      setNotes((prev) => [{ id: crypto.randomUUID(), body: noteText.trim(), created_at: new Date().toISOString() }, ...prev]);
      setNoteText("");
    }
  }

  return (
    <>
      <Modal open={Boolean(workItemId)} onClose={onClose} widthClass="max-w-2xl">
        <div className="max-h-[85vh] overflow-y-auto p-6">
          {loading || !item ? (
            <p className="py-10 text-center text-sm text-ink-400">Cargando...</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <input
                  value={item.title}
                  onChange={(e) => update("title", e.target.value)}
                  className="w-full border-none bg-transparent text-lg font-semibold text-ink-900 outline-none"
                />
                <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
                  {item.status}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-accent-100 bg-accent-50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-600">Action</p>
                  <input
                    value={item.next_action ?? ""}
                    onChange={(e) => update("next_action", e.target.value || null)}
                    placeholder="Sin accion"
                    className="input"
                  />
                  <div className="mt-2">
                    <label className="label">Vence</label>
                    <input
                      type="date"
                      value={item.due_date ?? ""}
                      onChange={(e) => update("due_date", e.target.value || null)}
                      className="input"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-waiting-100 bg-waiting-100/40 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-waiting-600">Waiting</p>
                  <input
                    value={item.waiting_for_what ?? ""}
                    onChange={(e) => update("waiting_for_what", e.target.value || null)}
                    placeholder="Sin espera"
                    className="input"
                  />
                  <div className="mt-2">
                    <label className="label">Esperado</label>
                    <input
                      type="date"
                      value={item.expected_date ?? ""}
                      onChange={(e) => update("expected_date", e.target.value || null)}
                      className="input"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Empresa</label>
                  <select
                    value={item.company_id ?? ""}
                    onChange={(e) => update("company_id", e.target.value || null)}
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
                    onChange={(e) => update("context_id", e.target.value || null)}
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
                    onChange={(e) => update("category", (e.target.value || null) as WorkItemCategory | null)}
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
                        onClick={() => update("estimated_minutes", item.estimated_minutes === m ? null : m)}
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
                    onChange={(e) => update("blocking", e.target.checked)}
                  />
                  Esto bloquea otra actividad
                </label>
                {item.blocking && (
                  <input
                    value={item.blocking_note ?? ""}
                    onChange={(e) => update("blocking_note", e.target.value || null)}
                    placeholder="Que bloquea?"
                    className="input mt-2"
                  />
                )}
              </div>

              <div className="mt-4 flex justify-end">
                <button type="button" onClick={handleSaveEdits} disabled={saving} className="btn-primary">
                  {saving ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>

              <div className="mt-6 flex flex-wrap gap-2 border-y border-ink-100 py-4">
                <button type="button" className="btn-secondary" onClick={() => runAction("done")}>
                  Done
                </button>
                <button type="button" className="btn-secondary" onClick={() => setDatePickerFor("postpone")}>
                  Postpone
                </button>
                <button type="button" className="btn-secondary" onClick={() => setDelegateOpen(true)}>
                  Delegate
                </button>
                {item.waiting_for_what && (
                  <button type="button" className="btn-secondary" onClick={() => runAction("received")}>
                    Received
                  </button>
                )}
                {(item.status === "DONE" || item.status === "IGNORED") && (
                  <button type="button" className="btn-secondary" onClick={() => runAction("reopen")}>
                    Reopen
                  </button>
                )}
                <button type="button" className="btn-ghost" onClick={() => runAction("ignore")}>
                  Ignore
                </button>
              </div>

              {sources.length > 0 && (
                <div className="mt-4">
                  <p className="label">Fuentes</p>
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
                          Open in Gmail
                        </a>
                      )}
                    </div>
                  ))}
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
            </>
          )}
        </div>
      </Modal>

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

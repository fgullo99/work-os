"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CompanyRow, ContactRow, ContextRow, WorkItemCategory } from "@/lib/supabase/types";
import type { ManualCaptureResult } from "@/lib/ai/schema";
import { findBestMatch } from "@/lib/workItems/match";
import { Modal } from "./Modal";

interface NormalizeApiResult extends ManualCaptureResult {
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
}

const NEW_OPTION = "__new__";
const NONE_OPTION = "";

const CATEGORY_OPTIONS: { value: WorkItemCategory | ""; label: string }[] = [
  { value: "", label: "Sin categoria" },
  { value: "COMERCIAL", label: "Comercial" },
  { value: "TECNICO", label: "Tecnico" },
  { value: "OPERACIONES", label: "Operaciones" },
  { value: "ADMINISTRATIVO", label: "Administrativo" },
];

const ESTIMATED_OPTIONS = [5, 15, 30, 60] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  companies: CompanyRow[];
  contacts: ContactRow[];
  contexts: ContextRow[];
}

type Step = "input" | "loading" | "preview" | "error";

export function CaptureModal({ open, onClose, companies, contacts, contexts }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<NormalizeApiResult | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [waitingForWhat, setWaitingForWhat] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [committedDate, setCommittedDate] = useState("");
  const [companySel, setCompanySel] = useState<string>(NONE_OPTION);
  const [companyNewName, setCompanyNewName] = useState("");
  const [contextSel, setContextSel] = useState<string>(NONE_OPTION);
  const [contextNewName, setContextNewName] = useState("");
  const [contactSel, setContactSel] = useState<string>(NONE_OPTION);
  const [contactNewName, setContactNewName] = useState("");
  const [category, setCategory] = useState<WorkItemCategory | "">("");
  const [blocking, setBlocking] = useState(false);
  const [blockingNote, setBlockingNote] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);

  function reset() {
    setStep("input");
    setText("");
    setErrorMessage(null);
    setAiResult(null);
    setTitle("");
    setNextAction("");
    setDueDate("");
    setWaitingForWhat("");
    setExpectedDate("");
    setCommittedDate("");
    setCompanySel(NONE_OPTION);
    setCompanyNewName("");
    setContextSel(NONE_OPTION);
    setContextNewName("");
    setContactSel(NONE_OPTION);
    setContactNewName("");
    setCategory("");
    setBlocking(false);
    setBlockingNote("");
    setEstimatedMinutes(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmitText(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setStep("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/capture/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMessage(data.error ?? "No pude interpretar esto con suficiente confianza.");
        setStep("error");
        return;
      }
      applyResult(data.result as NormalizeApiResult);
      setStep("preview");
    } catch {
      setErrorMessage("No pude conectarme para interpretar el texto.");
      setStep("error");
    }
  }

  function applyResult(result: NormalizeApiResult) {
    setAiResult(result);
    setTitle(result.title);
    setNextAction(result.next_action ?? "");
    setDueDate(result.due_date ?? "");
    setWaitingForWhat(result.waiting_for_what ?? "");
    setExpectedDate(result.expected_date ?? "");
    setCommittedDate(result.committed_date ?? "");
    setCategory(result.suggested_category ?? "");
    setBlocking(result.blocking);

    const companyMatch = findBestMatch(companies, result.suggested_company);
    setCompanySel(companyMatch ? companyMatch.id : result.suggested_company ? NEW_OPTION : NONE_OPTION);
    setCompanyNewName(companyMatch ? "" : result.suggested_company ?? "");

    const contextMatch = findBestMatch(contexts, result.suggested_context);
    setContextSel(contextMatch ? contextMatch.id : result.suggested_context ? NEW_OPTION : NONE_OPTION);
    setContextNewName(contextMatch ? "" : result.suggested_context ?? "");

    const contactQuery = result.waiting_for_person ?? result.suggested_contact;
    const contactMatch = findBestMatch(contacts, contactQuery);
    setContactSel(contactMatch ? contactMatch.id : contactQuery ? NEW_OPTION : NONE_OPTION);
    setContactNewName(contactMatch ? "" : contactQuery ?? "");
  }

  function startManual() {
    setAiResult(null);
    setTitle(text.slice(0, 80));
    setStep("preview");
  }

  async function resolveEntityId(kind: "company" | "contact" | "context", sel: string, newName: string): Promise<string | null> {
    if (sel === NONE_OPTION) return null;
    if (sel !== NEW_OPTION) return sel;
    if (!newName.trim()) return null;

    const endpoint = kind === "company" ? "/api/companies" : kind === "contact" ? "/api/contacts" : "/api/contexts";
    const body = kind === "context" ? { title: newName.trim() } : { name: newName.trim() };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return null;
    return (data.company ?? data.contact ?? data.context)?.id ?? null;
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      const [companyId, contactId, contextId] = await Promise.all([
        resolveEntityId("company", companySel, companyNewName),
        resolveEntityId("contact", contactSel, contactNewName),
        resolveEntityId("context", contextSel, contextNewName),
      ]);

      const aiOriginal = aiResult
        ? {
            title: aiResult.title,
            next_action: aiResult.next_action,
            waiting_for_what: aiResult.waiting_for_what,
            due_date: aiResult.due_date,
            expected_date: aiResult.expected_date,
            committed_date: aiResult.committed_date,
            category: aiResult.suggested_category,
            blocking: String(aiResult.blocking),
          }
        : undefined;

      const res = await fetch("/api/work-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Sin titulo",
          context_id: contextId,
          company_id: companyId,
          contact_id: null,
          category: category || null,
          next_action: nextAction.trim() || null,
          waiting_for_what: waitingForWhat.trim() || null,
          waiting_for_contact_id: contactId,
          due_date: dueDate || null,
          expected_date: expectedDate || null,
          committed_date: committedDate || null,
          blocking,
          blocking_note: blocking ? blockingNote.trim() || null : null,
          estimated_minutes: estimatedMinutes,
          ai_summary: aiResult?.summary ?? null,
          ai_confidence: aiResult?.confidence ?? null,
          rawText: text,
          aiOriginal,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMessage("No se pudo guardar el Work Item. Intenta de nuevo.");
        setStep("error");
        return;
      }
      handleClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const showInfoNotice = !nextAction.trim() && !waitingForWhat.trim();

  return (
    <Modal open={open} onClose={handleClose} widthClass="max-w-xl">
      <div className="max-h-[85vh] overflow-y-auto p-6">
        {step === "input" && (
          <form onSubmit={handleSubmitText}>
            <h2 className="text-lg font-semibold text-ink-900">Capture</h2>
            <p className="mt-1 text-sm text-ink-500">
              Escribi en lenguaje natural. Ej: &quot;Esperando planos de Carlos para el miercoles&quot;.
            </p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="input mt-4 resize-none"
              placeholder="Que necesitas registrar?"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={handleClose} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={!text.trim()} className="btn-primary">
                Procesar
              </button>
            </div>
          </form>
        )}

        {step === "loading" && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
            <p className="text-sm text-ink-500">Interpretando...</p>
          </div>
        )}

        {step === "error" && (
          <div>
            <h2 className="text-lg font-semibold text-ink-900">No pude interpretar esto con suficiente confianza.</h2>
            <p className="mt-2 text-sm text-ink-500">{errorMessage}</p>
            <div className="mt-3 rounded-md bg-ink-50 p-3 text-sm text-ink-600">{text}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setStep("input")} className="btn-secondary">
                Reintentar
              </button>
              <button type="button" onClick={startManual} className="btn-primary">
                Crear manualmente
              </button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Revisar antes de guardar</h2>
            {aiResult && (
              <p className="mt-1 text-xs text-ink-400">
                Confianza IA: {aiResult.confidence} - {aiResult.summary}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <label className="label">Titulo</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
              </div>

              {showInfoNotice && (
                <div className="rounded-lg border border-ink-100 bg-ink-50 p-3 text-sm text-ink-600">
                  Esto parece informacion sin accion pendiente. Se guarda igual como registro; completa Action o
                  Waiting abajo si corresponde.
                </div>
              )}

              <div className="rounded-lg border border-accent-100 bg-accent-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-600">Action</p>
                <input
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder="Que hay que hacer? (opcional)"
                  className="input"
                />
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-ink-500">Vence:</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input w-auto" />
                </div>
              </div>

              <div className="rounded-lg border border-waiting-100 bg-waiting-100/40 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-waiting-600">Waiting</p>
                <input
                  value={waitingForWhat}
                  onChange={(e) => setWaitingForWhat(e.target.value)}
                  placeholder="Que estas esperando? (opcional)"
                  className="input"
                />
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-ink-500">Esperado:</label>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="input w-auto"
                  />
                </div>
              </div>

              {committedDate && (
                <div>
                  <label className="label">Fecha de compromiso</label>
                  <input
                    type="date"
                    value={committedDate}
                    onChange={(e) => setCommittedDate(e.target.value)}
                    className="input w-auto"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <EntitySelect
                  label="Empresa"
                  items={companies}
                  labelKey="name"
                  value={companySel}
                  newName={companyNewName}
                  onChange={setCompanySel}
                  onNewNameChange={setCompanyNewName}
                />
                <EntitySelect
                  label="Context"
                  items={contexts}
                  labelKey="title"
                  value={contextSel}
                  newName={contextNewName}
                  onChange={setContextSel}
                  onNewNameChange={setContextNewName}
                />
              </div>

              {waitingForWhat.trim() && (
                <EntitySelect
                  label="Esperando de"
                  items={contacts}
                  labelKey="name"
                  value={contactSel}
                  newName={contactNewName}
                  onChange={setContactSel}
                  onNewNameChange={setContactNewName}
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Categoria</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as WorkItemCategory | "")}
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
                        onClick={() => setEstimatedMinutes(estimatedMinutes === m ? null : m)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                          estimatedMinutes === m
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

              <div>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
                  Esto bloquea otra actividad
                </label>
                {blocking && (
                  <input
                    value={blockingNote}
                    onChange={(e) => setBlockingNote(e.target.value)}
                    placeholder="Que bloquea? (ej: produccion)"
                    className="input mt-2"
                  />
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-ink-100 pt-4">
              <button type="button" onClick={handleClose} className="btn-ghost">
                Cancelar
              </button>
              <button type="button" onClick={handleConfirm} disabled={saving || !title.trim()} className="btn-primary">
                {saving ? "Guardando..." : "Confirm"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function EntitySelect<T extends { id: string; name?: string; title?: string }>({
  label,
  items,
  labelKey,
  value,
  newName,
  onChange,
  onNewNameChange,
}: {
  label: string;
  items: T[];
  labelKey: "name" | "title";
  value: string;
  newName: string;
  onChange: (v: string) => void;
  onNewNameChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
        <option value={NONE_OPTION}>Sin {label.toLowerCase()}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item[labelKey] as string}
          </option>
        ))}
        <option value={NEW_OPTION}>+ Nuevo...</option>
      </select>
      {value === NEW_OPTION && (
        <input
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder={`Nombre de ${label.toLowerCase()}`}
          className="input mt-2"
        />
      )}
    </div>
  );
}

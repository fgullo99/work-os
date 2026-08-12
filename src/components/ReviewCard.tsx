"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewItemRow } from "@/lib/supabase/types";
import type { ReviewProposedPayload } from "@/lib/gmail/types";
import { Badge } from "./Badge";
import { SourceBadge } from "./SourceBadge";
import { useToast } from "./Toast";

const CONFIDENCE_TONE: Record<string, "action" | "waiting" | "neutral"> = {
  HIGH: "action",
  MEDIUM: "waiting",
  LOW: "neutral",
};

const KIND_LABEL: Record<string, string> = {
  NEW_WORK_ITEM: "Nueva sugerencia",
  UPDATE_WORK_ITEM: "Actualizacion",
  POTENTIAL_COMMITMENT: "Posible compromiso",
  POSSIBLE_DUPLICATE: "Posible duplicado",
  RECEIVED_CHECK: "Actividad nueva",
};

export function ReviewCard({ item }: { item: ReviewItemRow }) {
  const router = useRouter();
  const toast = useToast();
  const payload = item.proposed_payload as unknown as ReviewProposedPayload;
  const via = item.raw_metadata?.provider === "zapia" ? "Zapia" : null;

  const [nextAction, setNextAction] = useState(payload.next_action ?? "");
  const [waitingForWhat, setWaitingForWhat] = useState(payload.waiting_for_what ?? "");
  const [dueDate, setDueDate] = useState(payload.due_date ?? "");
  const [expectedDate, setExpectedDate] = useState(payload.expected_date ?? "");
  const [busy, setBusy] = useState(false);

  function overrides(): Partial<ReviewProposedPayload> {
    return {
      next_action: nextAction.trim() || null,
      waiting_for_what: waitingForWhat.trim() || null,
      due_date: dueDate || null,
      expected_date: expectedDate || null,
    };
  }

  async function post(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/review/${item.id}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      router.refresh();
    } catch (err) {
      console.error(`[review-card] ${path} fallo:`, err);
      toast.show("No se pudo aplicar la accion. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  const isDuplicate = item.kind === "POSSIBLE_DUPLICATE";
  const isReceivedCheck = item.kind === "RECEIVED_CHECK";
  const showEditableFields = !isReceivedCheck;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={item.source_type} via={via} demo={item.is_demo} />
          {payload.suggested_contact && (
            <span className="text-xs font-medium text-ink-600">{payload.suggested_contact}</span>
          )}
          <Badge tone="neutral">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
          <Badge tone={CONFIDENCE_TONE[item.confidence] ?? "neutral"}>{item.confidence}</Badge>
        </div>
        {item.external_url && (
          <a href={item.external_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent-600 hover:underline">
            Ver original
          </a>
        )}
      </div>

      <p className="mt-2 text-[15px] font-semibold text-ink-900">{payload.title}</p>
      {item.rationale && <p className="mt-1 text-sm text-ink-600">{item.rationale}</p>}
      {item.evidence && <p className="mt-1 text-xs italic text-ink-400">&quot;{item.evidence}&quot;</p>}
      {payload.responsible && <p className="mt-1 text-xs text-ink-500">Delegado en: {payload.responsible}</p>}

      {isReceivedCheck && (
        <p className="mt-3 rounded-md bg-waiting-100/40 p-2 text-sm text-ink-700">
          {(payload as unknown as { note?: string }).note ?? "Hubo actividad nueva. ¿Resuelve lo que estabas esperando?"}
        </p>
      )}

      {isDuplicate && (
        <p className="mt-3 rounded-md bg-ink-50 p-2 text-sm text-ink-600">
          Podria ser el mismo asunto que {item.duplicate_candidate_ids?.length ?? 0} Work Item(s) ya existente(s). Busca en Search antes
          de crear uno nuevo si no estas seguro.
        </p>
      )}

      {showEditableFields && (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-accent-100 bg-accent-50 p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-600">Action</p>
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Sin accion" className="input" />
            <div className="mt-1.5 flex items-center gap-2">
              <label className="text-xs text-ink-500">Vence:</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input w-auto" />
            </div>
          </div>
          <div className="rounded-lg border border-waiting-100 bg-waiting-100/40 p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-waiting-600">Waiting</p>
            <input
              value={waitingForWhat}
              onChange={(e) => setWaitingForWhat(e.target.value)}
              placeholder="Sin espera"
              className="input"
            />
            {payload.waiting_for_person && <p className="mt-1 text-xs text-ink-500">Persona: {payload.waiting_for_person}</p>}
            <div className="mt-1.5 flex items-center gap-2">
              <label className="text-xs text-ink-500">Esperado:</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="input w-auto" />
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
        {item.kind === "NEW_WORK_ITEM" && (
          <button type="button" disabled={busy} className="btn-primary" onClick={() => post("accept", { overrides: overrides() })}>
            Accept
          </button>
        )}
        {item.kind === "UPDATE_WORK_ITEM" && (
          <button type="button" disabled={busy} className="btn-primary" onClick={() => post("apply", { overrides: overrides() })}>
            Apply
          </button>
        )}
        {item.kind === "POTENTIAL_COMMITMENT" && (
          <button type="button" disabled={busy} className="btn-primary" onClick={() => post("accept", { overrides: overrides() })}>
            Accept
          </button>
        )}
        {isDuplicate && (
          <button type="button" disabled={busy} className="btn-primary" onClick={() => post("accept", { overrides: overrides() })}>
            Create New
          </button>
        )}
        {isReceivedCheck && (
          <>
            <button type="button" disabled={busy} className="btn-primary" onClick={() => post("received")}>
              Received
            </button>
            <button type="button" disabled={busy} className="btn-secondary" onClick={() => post("keep-waiting")}>
              Keep Waiting
            </button>
          </>
        )}
        {!isReceivedCheck && (
          <button type="button" disabled={busy} className="btn-ghost" onClick={() => post("ignore")}>
            Ignore
          </button>
        )}
      </div>

      {!isReceivedCheck && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-ink-100 pt-2 text-xs text-ink-400">
          <span className="mr-1">La IA se equivocó?</span>
          <button type="button" disabled={busy} className="btn-ghost" onClick={() => post("feedback", { feedback: "WRONG" })}>
            Wrong
          </button>
          <button type="button" disabled={busy} className="btn-ghost" onClick={() => post("feedback", { feedback: "NOT_IMPORTANT" })}>
            Not Important
          </button>
          <button type="button" disabled={busy} className="btn-ghost" onClick={() => post("feedback", { feedback: "PERSONAL" })}>
            Personal
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

interface CatchupStateView {
  status: "in_progress" | "completed" | "failed";
  thread_queue: string[];
  cursor_index: number;
  processed_count: number;
  auto_created_count: number;
  auto_updated_count: number;
  no_op_count: number;
  review_count: number;
  ignored_count: number;
  rule_filtered_count: number;
  failed_count: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * Panel de Settings para el catch-up acotado de Gmail (ver src/lib/gmail/catchup.ts) — cada
 * click en "Continue catch-up" procesa UN lote (25 threads / 45s) y persiste el checkpoint,
 * nunca un sync monolitico sin resumen. Se muestra siempre en Settings: si no hay ningun
 * catch-up arrancado todavia, el mismo boton lo arranca (el backend hace auto-start).
 */
export function GmailCatchupPanel() {
  const [state, setState] = useState<CatchupStateView | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const res = await fetch("/api/gmail/catchup");
      const data = await res.json();
      if (data.ok) setState(data.state);
    } finally {
      setCheckedOnce(true);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleContinue() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/catchup", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        await loadStatus();
      } else {
        setError(data.error ?? "No se pudo procesar el lote.");
      }
    } catch {
      setError("No se pudo procesar el lote.");
    } finally {
      setLoading(false);
    }
  }

  if (!checkedOnce) return null;

  const pending = state ? state.thread_queue.length - state.cursor_index : 0;
  const isCompleted = state?.status === "completed" && pending === 0;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-800">Gmail Catch-up</h2>
        {state && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              isCompleted ? "bg-accent-100 text-accent-600" : "bg-waiting-100 text-waiting-600"
            }`}
          >
            {isCompleted ? "COMPLETO" : "EN CURSO"}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-400">
        Procesa el backlog de Gmail en lotes acotados (25 threads por vez) en vez de una corrida larga sin
        checkpoint — si se corta a mitad, el proximo lote sigue exactamente donde quedo.
      </p>

      {error && <div className="mt-2 rounded-md border border-risk-100 bg-risk-100 px-3 py-2 text-sm text-risk-600">{error}</div>}

      {state && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-600 sm:grid-cols-4">
          <div>Pending: {pending}</div>
          <div>Processed: {state.processed_count}</div>
          <div>Review: {state.review_count}</div>
          <div>Failed: {state.failed_count}</div>
          <div>Auto created: {state.auto_created_count}</div>
          <div>Auto updated: {state.auto_updated_count}</div>
          <div>No-op: {state.no_op_count}</div>
          <div>Ignored: {state.ignored_count}</div>
        </div>
      )}

      {!state && <p className="mt-3 text-sm text-ink-400">No hay ningun catch-up arrancado todavia.</p>}

      <div className="mt-3">
        {!isCompleted && (
          <button type="button" disabled={loading} onClick={handleContinue} className="btn-primary">
            {loading ? "Procesando lote..." : state ? "Continue catch-up" : "Iniciar catch-up"}
          </button>
        )}
        {isCompleted && (
          <p className="text-sm text-ink-600">
            Catch-up completo — {state?.processed_count} threads procesados. El cursor incremental normal ya quedo
            al dia.
          </p>
        )}
      </div>
    </section>
  );
}

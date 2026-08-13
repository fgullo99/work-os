"use client";

import { useEffect, useRef, useState } from "react";

interface CatchupStateView {
  status: "in_progress" | "completed" | "failed";
  thread_queue: string[];
  cursor_index: number;
  processed_count: number;
  auto_created_count: number;
  auto_updated_count: number;
  delegated_count: number;
  waiting_count: number;
  no_op_count: number;
  review_count: number;
  ignored_count: number;
  rule_filtered_count: number;
  failed_count: number;
  failed_threads: unknown[];
  permanently_failed_threads: unknown[];
  ai_calls_count: number;
  ai_input_tokens: number;
  ai_output_tokens: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface BatchCountsView {
  threadsProcessed: number;
  autoCreated: number;
  autoUpdated: number;
  delegated: number;
  waiting: number;
  noOp: number;
  ignored: number;
  review: number;
  failed: number;
  ruleFiltered: number;
  durationMs: number;
  aiUsage: { calls: number; inputTokens: number; outputTokens: number };
}

type ExecState = "IDLE" | "RUNNING" | "PAUSING" | "PAUSED" | "COMPLETED" | "ERROR";

const RUN_SIZE_OPTIONS = [25, 50, 100, null] as const;

function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Panel de Settings para el catch-up autonomo, pausable y resumible de Gmail (ver
 * src/lib/gmail/catchup.ts). "Run catch-up" dispara un loop client-side de requests
 * SECUENCIALES (nunca en paralelo) a POST /api/gmail/catchup — cada request procesa UN lote
 * acotado (~25 threads o ~45s) y hace checkpoint solo; el loop sigue automaticamente al
 * siguiente lote hasta llegar al tamaño de run elegido, terminarse el backlog, o que el
 * usuario aprete Pausar (que no cancela el lote en curso, solo evita que arranque el
 * siguiente). Un lock server-side (worker_locked_at/worker_id) evita que dos ejecuciones
 * concurrentes (dos pestañas) pisen el mismo lote.
 */
export function GmailCatchupPanel() {
  const [state, setState] = useState<CatchupStateView | null>(null);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [execState, setExecState] = useState<ExecState>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(25);
  const [runProcessed, setRunProcessed] = useState(0);
  const [lastBatch, setLastBatch] = useState<BatchCountsView | null>(null);

  const pauseRequestedRef = useRef(false);
  const runningRef = useRef(false);

  async function loadStatus(): Promise<CatchupStateView | null> {
    try {
      const res = await fetch("/api/gmail/catchup");
      const data = await res.json();
      if (data.ok) {
        setState(data.state);
        return data.state as CatchupStateView | null;
      }
      return null;
    } finally {
      setCheckedOnce(true);
    }
  }

  useEffect(() => {
    loadStatus().then((initial) => {
      if (initial?.status === "completed") setExecState("COMPLETED");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runLoop(targetCount: number | null) {
    if (runningRef.current) return; // guarda contra doble click
    runningRef.current = true;
    pauseRequestedRef.current = false;
    setError(null);
    setRunProcessed(0);
    setExecState("RUNNING");

    let processedThisRun = 0;

    while (true) {
      if (pauseRequestedRef.current) {
        setExecState("PAUSED");
        break;
      }

      let res: Response;
      try {
        res = await fetch("/api/gmail/catchup", { method: "POST" });
      } catch {
        setError("No se pudo conectar con el servidor.");
        setExecState("ERROR");
        break;
      }

      if (res.status === 409) {
        setError("Ya hay un catch-up en curso (otra pestaña u otro proceso). Esperá a que termine e intentá de nuevo.");
        setExecState("ERROR");
        break;
      }

      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Error desconocido procesando el lote.");
        setExecState("ERROR");
        break;
      }

      const result = data.result as {
        status: "in_progress" | "completed";
        thisBatch: BatchCountsView;
      };
      processedThisRun += result.thisBatch.threadsProcessed;
      setRunProcessed(processedThisRun);
      setLastBatch(result.thisBatch);
      await loadStatus();

      if (result.status === "completed") {
        setExecState("COMPLETED");
        break;
      }
      if (pauseRequestedRef.current) {
        setExecState("PAUSED");
        break;
      }
      if (targetCount !== null && processedThisRun >= targetCount) {
        setExecState("PAUSED");
        break;
      }
      // sigue automaticamente al proximo lote — siempre UNA request por vez, nunca en paralelo.
    }

    runningRef.current = false;
  }

  function handlePause() {
    pauseRequestedRef.current = true;
    setExecState("PAUSING");
  }

  if (!checkedOnce) return null;

  const isRunning = execState === "RUNNING" || execState === "PAUSING";
  const queueLength = state?.thread_queue.length ?? 0;
  const retrying = state?.failed_threads.length ?? 0;
  const permanentlyFailed = state?.permanently_failed_threads.length ?? 0;
  // Misma semantica que processedUniqueOf() en catchup.ts: suma de los 6 buckets de
  // resultado real — nunca cursor_index ni un contador acumulado que pueda arrastrar drift
  // (ver incidente real: processed_count llego a estar desalineado de la suma de buckets).
  const processed = state
    ? state.auto_created_count +
      state.auto_updated_count +
      state.no_op_count +
      state.review_count +
      state.ignored_count +
      state.rule_filtered_count
    : 0;
  const pending = state ? queueLength - processed - permanentlyFailed : 0;
  const progressPct = queueLength > 0 ? Math.min(100, Math.round((processed / queueLength) * 1000) / 10) : 0;

  const avgThreadMs = lastBatch && lastBatch.threadsProcessed > 0 ? lastBatch.durationMs / lastBatch.threadsProcessed : null;
  const estimatedRemainingMs = avgThreadMs !== null ? avgThreadMs * pending : null;

  const statusLabel: Record<ExecState, string> = {
    IDLE: state?.status === "completed" ? "COMPLETO" : "PAUSADO",
    RUNNING: "CORRIENDO",
    PAUSING: "PAUSANDO…",
    PAUSED: "PAUSADO",
    COMPLETED: "COMPLETO",
    ERROR: "ERROR",
  };
  const statusColor: Record<ExecState, string> = {
    IDLE: "bg-waiting-100 text-waiting-600",
    RUNNING: "bg-accent-100 text-accent-600",
    PAUSING: "bg-waiting-100 text-waiting-600",
    PAUSED: "bg-waiting-100 text-waiting-600",
    COMPLETED: "bg-accent-100 text-accent-600",
    ERROR: "bg-risk-100 text-risk-600",
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-800">Gmail Catch-up</h2>
        {state && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor[execState]}`}>
            {statusLabel[execState]}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-400">
        Procesa el backlog de Gmail en lotes acotados (~25 threads / ~45s cada uno, con checkpoint) — &ldquo;Run
        catch-up&rdquo; encadena los lotes que hagan falta solo, una request por vez, hasta el tamaño elegido o hasta
        que lo pausés.
      </p>

      {error && <div className="mt-2 rounded-md border border-risk-100 bg-risk-100 px-3 py-2 text-sm text-risk-600">{error}</div>}

      {state && (
        <>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-ink-600">
              <span>
                Processed: {processed} / {queueLength}
              </span>
              <span>Progress: {progressPct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-600 sm:grid-cols-4">
            <div>Pending: {pending}</div>
            <div>Review: {state.review_count}</div>
            <div>Auto created: {state.auto_created_count}</div>
            <div>Auto updated: {state.auto_updated_count}</div>
            <div>Delegated: {state.delegated_count}</div>
            <div>Waiting: {state.waiting_count}</div>
            <div>No-op: {state.no_op_count}</div>
            <div>Ignored: {state.ignored_count}</div>
            <div>Retrying: {retrying}</div>
            <div>Failed permanente: {permanentlyFailed}</div>
          </div>

          {lastBatch && (
            <div className="mt-3 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-500">
              <div className="font-medium text-ink-600">Current batch: {lastBatch.threadsProcessed} processed</div>
              <div className="mt-0.5 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                <div>Auto created: {lastBatch.autoCreated}</div>
                <div>Auto updated: {lastBatch.autoUpdated}</div>
                <div>Delegated: {lastBatch.delegated}</div>
                <div>Waiting: {lastBatch.waiting}</div>
                <div>No-op: {lastBatch.noOp}</div>
                <div>Ignored: {lastBatch.ignored}</div>
                <div>Review: {lastBatch.review}</div>
                <div>Failed: {lastBatch.failed}</div>
              </div>
              <div className="mt-1.5 text-[11px] text-ink-400">
                Last batch duration: {formatMs(lastBatch.durationMs)} · Average thread time: {formatMs(avgThreadMs)} · Estimated
                remaining: ~{formatMs(estimatedRemainingMs)} (aproximado)
              </div>
            </div>
          )}

          <div className="mt-2 text-[11px] text-ink-400">
            AI usage (total): {state.ai_calls_count} calls · {state.ai_input_tokens.toLocaleString("es-AR")} in /{" "}
            {state.ai_output_tokens.toLocaleString("es-AR")} out tokens
          </div>
        </>
      )}

      {!state && <p className="mt-3 text-sm text-ink-400">No hay ningun catch-up arrancado todavia.</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!isRunning && execState !== "COMPLETED" && (
          <>
            <span className="text-xs text-ink-500">
              Remaining: {pending} threads · Run next:
            </span>
            <select
              className="input w-auto py-1 text-xs"
              value={target === null ? "unlimited" : String(target)}
              onChange={(e) => setTarget(e.target.value === "unlimited" ? null : Number(e.target.value))}
              disabled={isRunning}
            >
              {RUN_SIZE_OPTIONS.map((opt) => (
                <option key={opt ?? "unlimited"} value={opt === null ? "unlimited" : opt}>
                  {opt === null ? "Until paused" : `${opt} threads`}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => runLoop(target)} className="btn-primary" disabled={pending === 0}>
              Run catch-up
            </button>
          </>
        )}

        {isRunning && (
          <>
            <span className="text-xs text-ink-500">
              {runProcessed} {target !== null ? `/ ${target}` : ""} procesados en este run…
            </span>
            <button type="button" onClick={handlePause} disabled={execState === "PAUSING"} className="btn-secondary">
              {execState === "PAUSING" ? "Terminando el lote actual…" : "Pause"}
            </button>
          </>
        )}

        {execState === "COMPLETED" && (
          <p className="text-sm text-ink-600">
            Catch-up completo — {processed} threads procesados. El cursor incremental normal ya quedo al dia.
          </p>
        )}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeEs } from "@/lib/format/date";

interface ZapiaStatus {
  configured: boolean;
  lastBatch: { batchId: string | null; receivedAt: string; status: string; messageCount: number } | null;
  lastSuccessfulSync: string | null;
  reviewPending: number;
  errors: number;
}

export function WhatsAppStatusPanel() {
  const router = useRouter();
  const [quickCaptureConfigured, setQuickCaptureConfigured] = useState<boolean | null>(null);
  const [zapia, setZapia] = useState<ZapiaStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  function loadStatus() {
    fetch("/api/capture/whatsapp/status")
      .then((res) => res.json())
      .then((data) => setQuickCaptureConfigured(Boolean(data.configured)))
      .catch(() => setQuickCaptureConfigured(false));

    fetch("/api/zapia/status")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setZapia({
            configured: data.configured,
            lastBatch: data.lastBatch,
            lastSuccessfulSync: data.lastSuccessfulSync,
            reviewPending: data.reviewPending,
            errors: data.errors,
          });
        }
      })
      .catch(() => setZapia(null));
  }

  useEffect(loadStatus, []);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/zapia/test", { method: "POST" });
      const data = await res.json();
      setTestResult(data.ok ? `OK — resultado: ${data.outcome}` : `Error: ${data.error}`);
      loadStatus();
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-800">WhatsApp</h2>
      </div>

      <div className="mt-3 rounded-lg border border-ink-100 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink-800">Zapia (relevamiento automatico)</p>
          {zapia && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                zapia.configured ? "bg-accent-100 text-accent-600" : "bg-ink-100 text-ink-500"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${zapia.configured ? "bg-emerald-500" : "bg-ink-300"}`} />
              {zapia.configured ? "CONNECTED" : "NOT CONFIGURED"}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-500">Schedule: 11:00 · 15:00 · 18:00 (America/Argentina/Buenos_Aires)</p>
        {zapia?.lastBatch && (
          <p className="mt-1 text-xs text-ink-500">
            Last batch: {formatRelativeEs(zapia.lastBatch.receivedAt)} ({zapia.lastBatch.messageCount} mensaje
            {zapia.lastBatch.messageCount === 1 ? "" : "s"}, {zapia.lastBatch.status})
          </p>
        )}
        {zapia?.lastSuccessfulSync && (
          <p className="mt-1 text-xs text-ink-500">Last successful sync: {formatRelativeEs(zapia.lastSuccessfulSync)}</p>
        )}
        {zapia && <p className="mt-1 text-xs text-ink-500">Review pending: {zapia.reviewPending}</p>}
        {zapia && zapia.errors > 0 && <p className="mt-1 text-xs text-risk-600">Errors: {zapia.errors} (pendientes de retry)</p>}
        {zapia?.configured === false && (
          <p className="mt-2 text-xs text-risk-600">
            Falta configurar <code>ZAPIA_WEBHOOK_SECRET</code> en las variables de entorno del servidor.
          </p>
        )}
        <button type="button" disabled={testing} onClick={handleTest} className="btn-secondary mt-2">
          {testing ? "Probando..." : "Test Zapia Webhook"}
        </button>
        {testResult && <p className="mt-1 text-xs text-ink-500">{testResult}</p>}
      </div>

      <div className="mt-3 rounded-lg border border-ink-100 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink-800">Quick Capture (Apple Shortcut)</p>
          {quickCaptureConfigured !== null && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                quickCaptureConfigured ? "bg-accent-100 text-accent-600" : "bg-ink-100 text-ink-500"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${quickCaptureConfigured ? "bg-emerald-500" : "bg-ink-300"}`} />
              {quickCaptureConfigured ? "ENABLED" : "NOT CONFIGURED"}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Captura manual desde tu iPhone (Share → Work OS) para mensajes puntuales fuera del horario de Zapia.
        </p>
        {quickCaptureConfigured === false && (
          <p className="mt-2 text-xs text-risk-600">
            Falta configurar <code>WHATSAPP_CAPTURE_TOKEN</code>.
          </p>
        )}
        <p className="mt-2 text-xs font-medium text-ink-700">
          Setup iPhone Shortcut → paso a paso en <code>README.md</code>, seccion &quot;WhatsApp Quick Capture&quot;.
        </p>
      </div>
    </section>
  );
}

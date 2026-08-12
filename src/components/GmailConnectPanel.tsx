"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { GMAIL_READONLY_SCOPE } from "@/lib/google/constants";

interface SyncSummaryView {
  threadsAnalyzed: number;
  highItems: number;
  reviewItems: number;
  ignored: number;
  errors: number;
  autoCreated?: number;
  autoUpdated?: number;
  personalFiltered?: number;
}

interface ImportPreviewView {
  threadsFound: number;
  ruleFiltered: number;
  analyzedByAI: number;
  actions: number;
  waiting: number;
  commitments: number;
  info: number;
  ignored: number;
  highConfidence: number;
  review: number;
  possibleDuplicates: number;
  personal: number;
  autoCreated: number;
  autoUpdated: number;
}

interface StatusResponse {
  connected: boolean;
  needsReconnect?: boolean;
  lastError?: string | null;
  safeMode?: boolean;
  email?: string;
  bootstrapCompletedAt?: string | null;
  bootstrapRangeDays?: number | null;
  lastSyncedAt?: string | null;
  lastSyncSummary?: SyncSummaryView | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "No se pudo completar la conexion con Gmail. Intenta de nuevo.",
  auth_failed: "No se pudo completar la conexion con Gmail. Intenta de nuevo.",
  missing_tokens: "Google no devolvio los permisos necesarios. Proba conectar de nuevo (a veces hace falta revocar el acceso previo en myaccount.google.com/permissions y reintentar).",
  save_failed: "No se pudo guardar la conexion. Intenta de nuevo.",
};

export function GmailConnectPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<7 | 14 | 30 | 60 | 90>(7);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);

  async function loadStatus() {
    const res = await fetch("/api/gmail/status");
    const data = await res.json();
    if (data.ok) setStatus(data);
  }

  useEffect(() => {
    loadStatus();
    const params = new URLSearchParams(window.location.search);
    const err = params.get("gmail_error");
    if (err) setError(ERROR_MESSAGES[err] ?? "Ocurrio un error conectando Gmail.");
    if (params.get("gmail") === "connected" || err) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleConnect() {
    const supabase = createSupabaseBrowserClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    // Proteccion CSRF del intercambio de codigo: @supabase/ssr usa flow PKCE por default
    // (createBrowserClient/createServerClient en src/lib/supabase/{browser,server}.ts), lo
    // que genera un code_verifier random guardado en una cookie httpOnly y exige que
    // coincida al canjear el codigo en /auth/gmail-callback. Es el equivalente funcional
    // (y mas fuerte, porque ata el codigo a un secreto del lado del cliente) al `state`
    // param clasico de OAuth2 — no hace falta un `state` manual ademas de esto, y agregar
    // uno propio via queryParams pisaria el que ya gestiona el SDK para el mismo intercambio.
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: GMAIL_READONLY_SCOPE,
        // access_type=offline + prompt=consent son necesarios para que Google devuelva un
        // refresh_token (si no, solo devuelve access_token, que expira en ~1h y no alcanza
        // para sincronizar en background). Ver src/app/auth/gmail-callback/route.ts.
        queryParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
        redirectTo: `${siteUrl}/auth/gmail-callback`,
      },
    });
  }

  async function handleDisconnect() {
    if (!window.confirm("Desconectar Gmail? Podes volver a conectarlo cuando quieras.")) return;
    setLoading(true);
    setError(null);
    try {
      await fetch("/api/gmail/disconnect", { method: "POST" });
      setPreview(null);
      await loadStatus();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleBootstrap() {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/gmail/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: range }),
      });
      const data = await res.json();
      if (data.ok) {
        setPreview(data.preview);
        await loadStatus();
        router.refresh();
      } else {
        setError(data.error ?? "No se pudo iniciar la sincronizacion.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncNow() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        await loadStatus();
        router.refresh();
      } else {
        setError(data.error ?? "No se pudo sincronizar.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-800">Gmail</h2>
        {status?.connected && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              status.needsReconnect ? "bg-risk-100 text-risk-600" : "bg-accent-100 text-accent-600"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${status.needsReconnect ? "bg-risk-600" : "bg-emerald-500"}`} />
            {status.needsReconnect ? "NEEDS RECONNECT" : "CONNECTED"}
          </span>
        )}
      </div>

      {error && <div className="mt-2 rounded-md border border-risk-100 bg-risk-100 px-3 py-2 text-sm text-risk-600">{error}</div>}

      {!status && <p className="mt-2 text-sm text-ink-400">Cargando...</p>}

      {status && status.needsReconnect && (
        <div className="mt-3 rounded-md border border-risk-100 bg-risk-100 px-3 py-2 text-sm text-risk-600">
          La conexion con Gmail dejo de ser valida (permiso revocado o credencial vencida). Volve a conectar para
          seguir sincronizando.
          {status.lastError && <p className="mt-1 text-xs text-risk-600/80">Detalle: {status.lastError}</p>}
        </div>
      )}

      {status && (!status.connected || status.needsReconnect) && (
        <div className="mt-3">
          <p className="text-sm text-ink-600">
            Solo lectura (<code>gmail.readonly</code>) — nunca se envian, borran ni modifican emails, ni se marcan
            leidos/no leidos.
          </p>
          <button type="button" onClick={handleConnect} className="btn-primary mt-3">
            {status.needsReconnect ? "Reconectar Gmail" : "Conectar Gmail"}
          </button>
        </div>
      )}

      {status && status.connected && !status.needsReconnect && !status.bootstrapCompletedAt && (
        <div className="mt-3">
          <p className="text-sm text-ink-600">
            Conectado como <strong>{status.email}</strong>. Primera sincronizacion: recomendado empezar por los
            ultimos 7 dias.
          </p>
          <div className="mt-2 flex gap-2">
            {([7, 14, 30, 60, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRange(d)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  range === d ? "border-accent-500 bg-accent-500 text-white" : "border-ink-200 text-ink-600"
                }`}
              >
                Ultimos {d} dias
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-400">
            Safe Mode esta {status.safeMode === false ? "desactivado" : "activado"}: mientras este activado, nada se
            crea ni actualiza solo — todo lo relevante va a Review para que lo confirmes vos.
          </p>
          <button type="button" disabled={loading} onClick={handleBootstrap} className="btn-primary mt-3">
            {loading ? "Sincronizando..." : `Iniciar sincronizacion (${range} dias)`}
          </button>
        </div>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-ink-100 bg-ink-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Gmail import preview</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-700 sm:grid-cols-3">
            <div>Threads encontrados: {preview.threadsFound}</div>
            <div>Descartados por reglas: {preview.ruleFiltered}</div>
            <div>Analizados por AI: {preview.analyzedByAI}</div>
            <div>Actions: {preview.actions}</div>
            <div>Waiting: {preview.waiting}</div>
            <div>Commitments: {preview.commitments}</div>
            <div>Info: {preview.info}</div>
            <div>Ignore: {preview.ignored}</div>
            <div>High confidence: {preview.highConfidence}</div>
            <div>Review: {preview.review}</div>
            <div>Possible duplicates: {preview.possibleDuplicates}</div>
            <div>Personal: {preview.personal}</div>
            <div>Auto created: {preview.autoCreated}</div>
            <div>Auto updated: {preview.autoUpdated}</div>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Nada de esto entro solo al Dashboard. Revisa las sugerencias en la seccion Review.
          </p>
        </div>
      )}

      {status && status.connected && !status.needsReconnect && status.bootstrapCompletedAt && (
        <div className="mt-3 text-sm text-ink-600">
          <p>
            Conectado como <strong>{status.email}</strong>.
          </p>
          <p className="mt-1 text-xs text-ink-400">
            Last sync: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("es-AR") : "nunca"}
          </p>
          {status.lastSyncSummary && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-600">
              <div>THREADS ANALYZED: {status.lastSyncSummary.threadsAnalyzed}</div>
              <div>HIGH ITEMS: {status.lastSyncSummary.highItems}</div>
              <div>REVIEW ITEMS: {status.lastSyncSummary.reviewItems}</div>
              <div>IGNORED: {status.lastSyncSummary.ignored}</div>
              <div>AUTO CREATED: {status.lastSyncSummary.autoCreated ?? 0}</div>
              <div>AUTO UPDATED: {status.lastSyncSummary.autoUpdated ?? 0}</div>
              <div>PERSONAL: {status.lastSyncSummary.personalFiltered ?? 0}</div>
            </div>
          )}

          <p className="mt-3 text-xs text-ink-400">
            AI Automation de Gmail se controla desde el panel &quot;AI Automation&quot; mas abajo en Settings.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={loading} onClick={handleSyncNow} className="btn-secondary">
              {loading ? "Sincronizando..." : "Sync now"}
            </button>
            <button type="button" disabled={loading} onClick={handleDisconnect} className="btn-ghost">
              Disconnect
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Next sync: Vercel Cron corre automaticamente todos los dias a las 7:00 ART (configurado en{" "}
            <code>vercel.json</code>). Usa &quot;Sync now&quot; si queres forzar una sincronizacion antes de esa hora.
          </p>
        </div>
      )}
    </section>
  );
}

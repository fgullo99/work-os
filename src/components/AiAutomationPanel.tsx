"use client";

import { useEffect, useState } from "react";

interface GmailStatusResponse {
  connected: boolean;
  safeMode?: boolean;
}

/**
 * "AI Automation": Gmail lee/escribe google_connection.safe_mode directamente (misma fuente
 * de verdad que usa el resto del pipeline — invertido para mostrar: safe_mode=false = ON).
 * WhatsApp lee/escribe automation_settings.whatsapp_auto_enabled (arranca en false, ver
 * src/lib/whatsapp/zapiaDecision.ts). Ninguno de los dos toggles vive en una tabla propia
 * "de settings de UI" — cada uno lee/escribe exactamente el campo que el pipeline usa.
 */
export function AiAutomationPanel() {
  const [gmail, setGmail] = useState<GmailStatusResponse | null>(null);
  const [whatsappAuto, setWhatsappAuto] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [gmailRes, waRes] = await Promise.all([fetch("/api/gmail/status"), fetch("/api/automation/whatsapp")]);
    const gmailData = await gmailRes.json();
    const waData = await waRes.json();
    if (gmailData.ok) setGmail(gmailData);
    if (waData.ok) setWhatsappAuto(waData.whatsappAutoEnabled);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleGmail() {
    if (!gmail) return;
    const next = !(gmail.safeMode === false);
    setLoading(true);
    try {
      await fetch("/api/gmail/safe-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !next }),
      });
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function toggleWhatsapp() {
    if (whatsappAuto === null) return;
    const next = !whatsappAuto;
    setLoading(true);
    try {
      await fetch("/api/automation/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      await load();
    } finally {
      setLoading(false);
    }
  }

  const gmailOn = gmail?.safeMode === false;

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink-800">AI Automation</h2>
      <p className="mt-1 text-xs text-ink-400">
        High confidence decisions are applied automatically. Ambiguous decisions go to Review.
      </p>

      <div className="mt-3 flex items-center justify-between rounded-md border border-ink-100 px-3 py-2">
        <div>
          <p className="text-sm font-medium text-ink-800">Gmail</p>
          <p className="text-xs text-ink-400">
            {gmail?.connected
              ? gmailOn
                ? "ON: HIGH confidence crea/actualiza automaticamente, MEDIUM/UNCERTAIN sigue yendo a Review."
                : "OFF: todo va a Review."
              : "Conecta Gmail primero (arriba)."}
          </p>
        </div>
        <button
          type="button"
          disabled={loading || !gmail?.connected}
          onClick={toggleGmail}
          className="btn-secondary shrink-0"
        >
          {gmailOn ? "Desactivar" : "Activar"}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-md border border-ink-100 px-3 py-2">
        <div>
          <p className="text-sm font-medium text-ink-800">WhatsApp</p>
          <p className="text-xs text-ink-400">
            {whatsappAuto
              ? "ON: HIGH confidence + relevancia WORK crea/actualiza automaticamente."
              : "OFF (default): todo lo relevante sigue yendo a Review — recomendado hasta validar con un batch real."}
          </p>
        </div>
        <button type="button" disabled={loading || whatsappAuto === null} onClick={toggleWhatsapp} className="btn-secondary shrink-0">
          {whatsappAuto ? "Desactivar" : "Activar"}
        </button>
      </div>

      <p className="mt-3 text-xs text-ink-400">
        En ambos casos: PERSONAL siempre se ignora, y ningun campo ya cargado (company, context, responsible, fecha
        existente) se pisa automaticamente — eso siempre va a Review.
      </p>
    </section>
  );
}

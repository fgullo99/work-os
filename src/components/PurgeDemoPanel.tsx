"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PurgeResult {
  reviewItems: number;
  sourceLinks: number;
  notes: number;
  workItems: number;
  contacts: number;
  contexts: number;
  companies: number;
}

export function PurgeDemoPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePurge() {
    if (
      !window.confirm(
        "Esto borra SOLO los datos de demostracion (companies/contacts/contexts/work items/sugerencias marcados is_demo=true). Los datos reales no se tocan. Continuar?"
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/purge-demo", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setResult(data.result);
        router.refresh();
      } else {
        setError(data.error ?? "No se pudo purgar los datos de demostracion.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink-800">Datos de demostracion</h2>
      <p className="mt-2 text-sm text-ink-600">
        Antes de usar Work OS con datos reales, purga lo que creo <code>npm run seed</code>. Solo borra filas
        marcadas como demo — nunca toca companies/contacts/contexts/work items reales.
      </p>
      {error && <p className="mt-2 text-sm text-risk-600">{error}</p>}
      {result && (
        <div className="mt-2 rounded-md bg-ink-50 p-2.5 text-xs text-ink-600">
          Borrado: {result.workItems} work items, {result.companies} companies, {result.contacts} contacts,{" "}
          {result.contexts} contexts, {result.sourceLinks} sources, {result.reviewItems} review items,{" "}
          {result.notes} notes.
        </div>
      )}
      <button type="button" disabled={loading} onClick={handlePurge} className="btn-secondary mt-3">
        {loading ? "Purgando..." : "Purge demo data"}
      </button>
    </section>
  );
}

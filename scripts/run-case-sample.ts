/**
 * Prueba real de Fase 2 del pivot a Case: corre UN lote acotado (25 threads, dentro del rango
 * 20-30 pedido) contra el backlog real pendiente en gmail_catchup_state, usando el mismo
 * runCaseCatchupBatch que despues corre el panel de Settings — mismo camino de codigo (Gmail
 * real, IA real, matching real), este script no reimplementa nada, solo lo dispara una vez con
 * un batchSize acotado y un timeBudget generoso (corriendo local, sin el limite de 60s de
 * Vercel).
 *
 * NUNCA sigue con el resto del backlog automaticamente (una sola llamada, un solo lote) — ver
 * la instruccion original del pivot: "STOP. No continuar catch-up masivo todavia".
 *
 * Uso: npx tsx --env-file=.env.local scripts/run-case-sample.ts
 */
import { createClient } from "@supabase/supabase-js";
import { getActiveConnection } from "../src/lib/google/connection";
import { runCaseCatchupBatch } from "../src/lib/cases/caseCatchup";
import type { CaseRow, CaseSourceLinkRow } from "../src/lib/supabase/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SAMPLE_SIZE = 25;

async function main() {
  const connection = await getActiveConnection(supabase);
  if (!connection) {
    console.error("No hay conexion de Gmail activa.");
    process.exit(1);
  }
  if (connection.needs_reconnect) {
    console.error("La conexion de Gmail necesita reconexion (needs_reconnect=true). Reconecta antes de correr esto.");
    process.exit(1);
  }

  console.log(`Corriendo lote de Case catch-up: hasta ${SAMPLE_SIZE} threads del backlog pendiente...`);
  console.log("");

  const result = await runCaseCatchupBatch(supabase, connection, {
    batchSize: SAMPLE_SIZE,
    timeBudgetMs: 5 * 60_000,
  });

  console.log("=== ENTRIES (thread por thread) ===");
  for (const e of result.entries) {
    console.log(
      `- ${e.threadId} | action=${e.action} | matchTier=${e.matchTier ?? "-"} | state=${e.currentState ?? "-"} | owner=${e.currentOwner ?? "-"} | ruleFiltered=${e.ruleFilterSkipped}`
    );
  }
  console.log("");

  console.log("=== ESTE LOTE ===");
  console.log(JSON.stringify(result.thisBatch, null, 2));
  console.log("");
  console.log("=== TOTAL ACUMULADO (case_catchup_state) ===");
  console.log(JSON.stringify(result.total, null, 2));
  console.log("");
  console.log(`Reintentos pendientes: ${result.retryableFailedCount} | Fallidos definitivos: ${result.permanentlyFailedCount}`);
  console.log("");

  const threadsWithCaseCount = result.entries.filter((e) => e.resultingCaseId).length;
  const distinctCaseIds = Array.from(new Set(result.entries.map((e) => e.resultingCaseId).filter((id): id is string => Boolean(id))));
  const avgThreadsPerCase = distinctCaseIds.length > 0 ? (threadsWithCaseCount / distinctCaseIds.length).toFixed(2) : "0";
  console.log(`Threads con Case resultante: ${threadsWithCaseCount} | Cases distintos: ${distinctCaseIds.length} | Promedio threads/Case: ${avgThreadsPerCase}`);
  console.log("");

  if (distinctCaseIds.length > 0) {
    const { data, error } = await supabase.from("case").select("*").in("id", distinctCaseIds).order("last_activity_at", { ascending: false });
    if (error) throw error;
    const cases = (data ?? []) as CaseRow[];

    console.log(`=== CASES TOCADOS EN ESTE LOTE (${cases.length}) ===`);
    for (const c of cases) {
      const { data: sources, error: srcErr } = await supabase
        .from("case_source_link")
        .select("*")
        .eq("case_id", c.id)
        .order("occurred_at", { ascending: true });
      if (srcErr) throw srcErr;
      const timeline = (sources ?? []) as CaseSourceLinkRow[];

      console.log("");
      console.log(`Case: ${c.title}`);
      console.log(`  id: ${c.id}`);
      console.log(`  reference: ${c.reference_type ?? "-"} ${c.reference_value ?? "-"}`);
      console.log(`  current_state: ${c.current_state} | current_owner: ${c.current_owner} | felipe_action_required: ${c.felipe_action_required}`);
      console.log(`  next_action: ${c.next_action ?? "-"}`);
      console.log(`  waiting_for: ${c.waiting_for ?? "-"}`);
      console.log(`  responsible: ${c.responsible ?? "-"}`);
      console.log(`  risk: ${c.risk} | confidence: ${c.confidence ?? "-"}`);
      console.log(`  last_meaningful_event: ${c.last_meaningful_event ?? "-"}`);
      console.log(`  ai_summary: ${c.ai_summary ?? "-"}`);
      console.log(`  timeline (${timeline.length} eventos, ${new Set(timeline.map((s) => s.external_id)).size} thread(s) distinto(s)):`);
      for (const s of timeline) {
        console.log(`    - ${s.occurred_at} | ${s.event_label ?? s.source_type}`);
      }
    }
  }

  console.log("");
  console.log("=== FIN — no se continua el resto del backlog automaticamente ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

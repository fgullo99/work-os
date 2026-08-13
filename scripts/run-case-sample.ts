/**
 * Prueba real del pivot a Case contra el backlog pendiente en gmail_catchup_state, usando el
 * mismo runCaseCatchupBatch que despues corre el panel de Settings — mismo camino de codigo
 * (Gmail real, IA real, matching real, gates reales). Este script SOLO orquesta y reporta,
 * nunca reimplementa ni ajusta reglas de negocio (Case Analyzer, matching, gates, Kanban viven
 * en src/lib/cases/*, sin tocar).
 *
 * NUNCA sigue con el resto del backlog automaticamente (una sola llamada, un solo lote).
 *
 * Uso: npx tsx --env-file=.env.local scripts/run-case-sample.ts [batchSize=25]
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

const SAMPLE_SIZE = Number(process.argv[2] ?? 25) || 25;
// Presupuesto generoso escalado al tamaño del lote (~25s/thread de margen, corriendo local sin
// el limite de 60s de Vercel) — nunca corta el lote a mitad de camino por tiempo.
const TIME_BUDGET_MS = Math.max(5 * 60_000, SAMPLE_SIZE * 25_000);

const STATE_KEYS = ["ACTION_ME", "WAITING_EXTERNAL", "DELEGATED_INTERNAL", "BLOCKED", "NO_ACTION", "CLOSED", "REVIEW"] as const;

function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|rv|fwd|fw)\s*:\s*/gi, "")
    .trim()
    .toLowerCase();
}

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

  console.log(`Corriendo lote de Case catch-up: hasta ${SAMPLE_SIZE} threads del backlog pendiente (budget ${TIME_BUDGET_MS}ms)...`);
  console.log("");

  const result = await runCaseCatchupBatch(supabase, connection, {
    batchSize: SAMPLE_SIZE,
    timeBudgetMs: TIME_BUDGET_MS,
  });

  const b = result.thisBatch;
  const threadsProcessed = b.threadsProcessed;
  const failureRate = threadsProcessed > 0 ? ((b.failed / threadsProcessed) * 100).toFixed(1) : "0.0";

  // Cases tocados en este lote especifico (no el acumulado historico).
  const distinctCaseIds = Array.from(new Set(result.entries.map((e) => e.resultingCaseId).filter((id): id is string => Boolean(id))));

  let cases: CaseRow[] = [];
  let sourcesByCase = new Map<string, CaseSourceLinkRow[]>();
  if (distinctCaseIds.length > 0) {
    const { data: caseData, error: caseErr } = await supabase.from("case").select("*").in("id", distinctCaseIds);
    if (caseErr) throw caseErr;
    cases = (caseData ?? []) as CaseRow[];

    const { data: sourceData, error: srcErr } = await supabase
      .from("case_source_link")
      .select("*")
      .in("case_id", distinctCaseIds)
      .order("occurred_at", { ascending: true });
    if (srcErr) throw srcErr;
    for (const s of (sourceData ?? []) as CaseSourceLinkRow[]) {
      const list = sourcesByCase.get(s.case_id) ?? [];
      list.push(s);
      sourcesByCase.set(s.case_id, list);
    }
  }
  const casesById = new Map(cases.map((c) => [c.id, c]));

  const stateCounts: Record<(typeof STATE_KEYS)[number], number> = {
    ACTION_ME: 0,
    WAITING_EXTERNAL: 0,
    DELEGATED_INTERNAL: 0,
    BLOCKED: 0,
    NO_ACTION: 0,
    CLOSED: 0,
    REVIEW: 0,
  };
  for (const c of cases) {
    if (c.current_state in stateCounts) stateCounts[c.current_state as (typeof STATE_KEYS)[number]] += 1;
  }

  let multiThreadCases = 0;
  let casesWith1 = 0;
  let casesWith2 = 0;
  let casesWith3Plus = 0;
  let totalThreadCount = 0;
  const threadCountByCase = new Map<string, number>();
  for (const c of cases) {
    const sources = sourcesByCase.get(c.id) ?? [];
    const n = new Set(sources.map((s) => s.external_id)).size;
    threadCountByCase.set(c.id, n);
    totalThreadCount += n;
    if (n >= 2) multiThreadCases += 1;
    if (n === 1) casesWith1 += 1;
    else if (n === 2) casesWith2 += 1;
    else if (n >= 3) casesWith3Plus += 1;
  }
  const avgThreadsPerCase = cases.length > 0 ? (totalThreadCount / cases.length).toFixed(2) : "0";

  console.log("=== RESUMEN (eventos por THREAD — fuente: case_catchup_state, contador nativo del pipeline, sin tocar) ===");
  console.log(`THREADS PROCESSED: ${threadsProcessed}`);
  console.log(`CASES CREATED: ${b.casesCreated}`);
  console.log(`THREADS MERGED INTO EXISTING CASE: ${b.threadsMerged}`);
  console.log(`MULTI-THREAD CASES: ${multiThreadCases}`);
  console.log(`CASE MERGE REVIEW: ${b.caseMergeReview}`);
  console.log(`CASE STATE REVIEW: ${b.caseStateReview}`);
  console.log(`FAILED: ${b.failed}`);
  console.log("");
  // Nota (aclaracion de metrica, no un bug): CASE STATE REVIEW arriba cuenta EVENTOS por
  // thread, no Cases distintos. Un Case que ya esta en REVIEW sigue "abierto" (no CLOSED), asi
  // que un thread posterior del MISMO lote puede volver a matchear contra el y reanalizarlo —
  // si eso pasa 2 veces sobre el mismo Case, o si un reanalisis posterior lo saca de REVIEW,
  // el conteo de Cases realmente en estado REVIEW al final (ver STATE DISTRIBUTION abajo) va a
  // ser <= a este numero. Ambas fuentes son correctas, miden unidades distintas (thread-event
  // vs snapshot final de Case) — no es una inconsistencia del pipeline.
  console.log("=== STATE DISTRIBUTION (Cases distintos tocados en este lote, snapshot final — no eventos por thread) ===");
  for (const key of STATE_KEYS) console.log(`${key}: ${stateCounts[key]}`);
  console.log("");
  const reviewRate = threadsProcessed > 0 ? (((b.caseMergeReview + b.caseStateReview) / threadsProcessed) * 100).toFixed(1) : "0.0";
  console.log(`REVIEW RATE: ${reviewRate}%`);
  console.log(`FAILURE RATE: ${failureRate}%`);
  console.log("");

  // --- 1. Merges automaticos entre threads DISTINTOS (matchTier EXACT/STRONG, nunca el
  // reproceso idempotente del mismo thread — ahi matchTier queda null). ---
  console.log("=== MERGES AUTOMATICOS ENTRE THREADS DISTINTOS ===");
  const mergeEntries = result.entries.filter((e) => e.action === "AUTO_MERGE" && (e.matchTier === "EXACT" || e.matchTier === "STRONG"));
  if (mergeEntries.length === 0) console.log("(ninguno en este lote)");
  for (const e of mergeEntries) {
    const c = e.resultingCaseId ? casesById.get(e.resultingCaseId) : null;
    const sources = e.resultingCaseId ? sourcesByCase.get(e.resultingCaseId) ?? [] : [];
    const subjects = Array.from(
      new Set(sources.map((s) => (s.raw_metadata as { subject?: string } | null)?.subject).filter((s): s is string => Boolean(s)))
    );
    console.log("");
    console.log(`Case: ${c?.title ?? e.resultingCaseId}`);
    console.log(`  reference: ${c?.reference_type ?? "-"} ${c?.reference_value ?? "-"}`);
    console.log(`  subjects involucrados: ${subjects.join(" | ")}`);
    console.log(`  match tier: ${e.matchTier}`);
    console.log(
      `  razon: ${
        e.matchTier === "EXACT"
          ? "referencia extraida del thread coincide con reference_value ya registrado en el Case"
          : "mismo company_id + mismo reference_type o titulo con similarity >= 0.6 (ver caseMatch.ts)"
      }`
    );
  }
  console.log("");

  // --- 2. Todos los ACTION_ME creados en este lote. ---
  console.log("=== ACTION_ME CREADOS ===");
  const actionMeCases = cases.filter((c) => c.current_state === "ACTION_ME");
  if (actionMeCases.length === 0) console.log("(ninguno en este lote)");
  for (const c of actionMeCases) printCase(c, sourcesByCase.get(c.id) ?? []);
  console.log("");

  // --- 3. Muestra de WAITING_EXTERNAL / DELEGATED_INTERNAL / NO_ACTION / REVIEW. ---
  const SAMPLE_N = 5;
  for (const state of ["WAITING_EXTERNAL", "DELEGATED_INTERNAL", "NO_ACTION", "REVIEW"] as const) {
    console.log(`=== MUESTRA ${state} (${stateCounts[state]} total, mostrando hasta ${SAMPLE_N}) ===`);
    const sample = cases.filter((c) => c.current_state === state).slice(0, SAMPLE_N);
    if (sample.length === 0) console.log("(ninguno en este lote)");
    for (const c of sample) printCase(c, sourcesByCase.get(c.id) ?? []);
    console.log("");
  }

  // --- 4. Candidatos a TOPIC DRIFT: mas de un subject normalizado distinto dentro del mismo
  // Case. Solo se reportan (con la evidencia cruda) — el juicio KEEP/SPLIT/UNCERTAIN lo hace
  // Felipe o el operador leyendo el resumen, esto no cambia nada solo. ---
  console.log("=== TOPIC_DRIFT_DETECTED (candidatos, requieren revision humana) ===");
  let driftCount = 0;
  for (const c of cases) {
    const sources = (sourcesByCase.get(c.id) ?? []).slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const subjectsInOrder = sources
      .map((s) => (s.raw_metadata as { subject?: string } | null)?.subject)
      .filter((s): s is string => Boolean(s));
    const normalized = subjectsInOrder.map(normalizeSubject);
    const distinctNormalized = Array.from(new Set(normalized));
    if (distinctNormalized.length > 1) {
      driftCount += 1;
      console.log("");
      console.log(`thread(s): ${c.id}`);
      console.log(`Case actual: ${c.title} (${c.current_state})`);
      console.log(`tema inicial (subject 1er mensaje): ${subjectsInOrder[0]}`);
      console.log(`tema actual (subject ultimo mensaje): ${subjectsInOrder[subjectsInOrder.length - 1]}`);
      console.log(`excerpt inicial: ${(sources[0]?.raw_excerpt ?? "").slice(0, 200)}`);
      console.log(`excerpt actual: ${(sources[sources.length - 1]?.raw_excerpt ?? "").slice(0, 200)}`);
      console.log("recommendation: (pendiente de revision humana — ver excerpts arriba)");
    }
  }
  if (driftCount === 0) console.log("(ninguno detectado en este lote)");
  console.log("");

  // --- 5. Grouping. ---
  console.log("=== GROUPING ===");
  console.log(`CASES WITH 1 THREAD: ${casesWith1}`);
  console.log(`CASES WITH 2 THREADS: ${casesWith2}`);
  console.log(`CASES WITH 3+ THREADS: ${casesWith3Plus}`);
  console.log(`AVERAGE THREADS PER CASE: ${avgThreadsPerCase}`);
  console.log("");

  console.log("=== TOTAL ACUMULADO (case_catchup_state) ===");
  console.log(JSON.stringify(result.total, null, 2));
  console.log("");
  console.log(`Reintentos pendientes: ${result.retryableFailedCount} | Fallidos definitivos: ${result.permanentlyFailedCount}`);
  console.log("");
  console.log("=== FIN — no se continua el resto del backlog automaticamente ===");
}

function printCase(c: CaseRow, sources: CaseSourceLinkRow[]) {
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
  console.log(`  timeline (${sources.length} eventos, ${new Set(sources.map((s) => s.external_id)).size} thread(s) distinto(s)):`);
  for (const s of sources) {
    console.log(`    - ${s.occurred_at} | ${s.event_label ?? s.source_type}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

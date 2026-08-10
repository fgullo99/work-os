/**
 * Smoke test del Normalizer de Gmail (normalizeEmailThread) contra casos sinteticos que
 * cubren los 4 ejemplos canonicos de DIRECCION del spec de Etapa 2 (seccion 8) + el caso
 * de DELEGACION explicita (seccion 9). Threads inventados a mano (no hace falta Gmail real
 * ni Supabase) — solo AI_PROVIDER + su API key. Mismo espiritu que eval-normalizer.ts.
 *
 * Uso: npm run eval:gmail-normalizer
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // ver preflight() mas abajo
}

import { getAIProvider } from "../src/lib/ai";
import type { EmailThreadResult } from "../src/lib/ai/emailSchema";
import { resolveDatePhrase } from "../src/lib/dates/resolveDatePhrase";
import { todayInTimezone } from "../src/lib/dates/timezone";
import type { NormalizedMessage, NormalizedThread } from "../src/lib/gmail/types";

function msg(partial: Partial<NormalizedMessage> & Pick<NormalizedMessage, "direction" | "bodyText">): NormalizedMessage {
  return {
    id: partial.id ?? "m1",
    from: partial.direction === "OUTBOUND" ? "felipe@tmcsudamerica.com.ar" : "cliente@empresa.com",
    fromName: partial.direction === "OUTBOUND" ? "Felipe" : "Cliente",
    to: [],
    cc: [],
    subject: partial.subject ?? "Asunto de prueba",
    date: partial.date ?? "2026-08-10T14:00:00.000Z",
    snippet: partial.bodyText.slice(0, 80),
    hasListUnsubscribe: false,
    ...partial,
  };
}

function thread(subject: string, messages: NormalizedMessage[]): NormalizedThread {
  return { threadId: "synthetic-thread", historyId: null, messages, subject, webUrl: "https://mail.google.com/mail/u/0/#all/synthetic" };
}

type ResolvedEmailResult = EmailThreadResult & { due_date: string | null; expected_date: string | null; committed_date: string | null };

function withResolvedDates(result: EmailThreadResult, todayISO: string): ResolvedEmailResult {
  return {
    ...result,
    due_date: resolveDatePhrase(result.due_date_phrase, todayISO),
    expected_date: resolveDatePhrase(result.expected_date_phrase, todayISO),
    committed_date: resolveDatePhrase(result.committed_date_phrase, todayISO),
  };
}

interface Case {
  id: number;
  label: string;
  thread: NormalizedThread;
  expectedBehavior: string;
  check: (r: ResolvedEmailResult) => boolean;
}

const CASES: Case[] = [
  {
    id: 1,
    label: "INBOUND — alguien me pide algo (spec seccion 8, ejemplo 1)",
    thread: thread("Consulta tecnica Ucc", [
      msg({ direction: "INBOUND", bodyText: "Felipe, ¿podés confirmarnos la Ucc del transformador?" }),
    ]),
    expectedBehavior: "ACTION (next_action != null, waiting_for_what == null)",
    check: (r) => r.next_action !== null && r.waiting_for_what === null,
  },
  {
    id: 2,
    label: "OUTBOUND — yo pregunto algo (spec seccion 8, ejemplo 2)",
    thread: thread("Tension secundaria", [
      msg({ direction: "OUTBOUND", bodyText: "Hola, ¿me pueden confirmar la tensión secundaria del equipo?" }),
    ]),
    expectedBehavior: "WAITING (waiting_for_what != null, next_action == null)",
    check: (r) => r.waiting_for_what !== null && r.next_action === null,
  },
  {
    id: 3,
    label: "OUTBOUND — yo prometo algo (spec seccion 8, ejemplo 3)",
    thread: thread("Cotizacion pendiente", [
      msg({ direction: "INBOUND", bodyText: "¿Cuando nos podrian pasar la cotizacion?" }),
      msg({ direction: "OUTBOUND", bodyText: "Te envío la cotización el martes.", id: "m2" }),
    ]),
    expectedBehavior: "ACTION + COMMITMENT (next_action != null, committed_date != null)",
    check: (r) => r.next_action !== null && r.committed_date !== null,
  },
  {
    id: 4,
    label: "INBOUND — alguien mas promete algo (spec seccion 8, ejemplo 4)",
    thread: thread("Planos", [msg({ direction: "INBOUND", bodyText: "Te mando los planos el viernes." })]),
    expectedBehavior: "WAITING (waiting_for_what != null, expected_date != null, next_action == null)",
    check: (r) => r.waiting_for_what !== null && r.expected_date !== null && r.next_action === null,
  },
  {
    id: 5,
    label: "OUTBOUND — delegacion explicita (spec seccion 9)",
    thread: thread("Revision de plano", [
      msg({ direction: "OUTBOUND", bodyText: "Le pedí a Nicolás que revise el plano para mañana." }),
    ]),
    expectedBehavior: "is_delegation=true, WAITING (next_action == null, waiting_for_person != null, waiting_for_what != null)",
    check: (r) => r.is_delegation === true && r.next_action === null && r.waiting_for_person !== null && r.waiting_for_what !== null,
  },
];

function preflight(): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const provider = process.env.AI_PROVIDER;
  if (!provider) missing.push("AI_PROVIDER");
  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (provider && provider !== "anthropic") missing.push(`AI_PROVIDER="${provider}" no soportado en V1`);
  return missing.length > 0 ? { ok: false, missing } : { ok: true };
}

async function main() {
  const pre = preflight();
  if (!pre.ok) {
    console.log("GMAIL NORMALIZER EVAL: NOT READY");
    console.log("");
    for (const m of pre.missing) console.log(`  MISSING: ${m}`);
    console.log("");
    console.log("Corre 'npm run check:setup' para un diagnostico completo. No se llamo al proveedor de IA.");
    process.exit(1);
  }

  const provider = getAIProvider();
  const todayISO = todayInTimezone();
  console.log(`Fecha de referencia: ${todayISO}`);
  console.log(`AI_PROVIDER: ${process.env.AI_PROVIDER}`);
  console.log("");

  let autoPass = 0;
  let reviewRequired = 0;
  let failedStructure = 0;

  for (const testCase of CASES) {
    console.log(`=== Caso ${testCase.id}: ${testCase.label} ===`);
    for (const m of testCase.thread.messages) {
      console.log(`  ${m.direction}: "${m.bodyText}"`);
    }
    console.log(`EXPECTED BEHAVIOR: ${testCase.expectedBehavior}`);

    let outcome: "AUTO PASS" | "REVIEW REQUIRED" | "FAILED STRUCTURE";
    try {
      const raw = await provider.normalizeEmailThread({ thread: testCase.thread, existingWorkItem: null, currentDateISO: todayISO });
      const resolved = withResolvedDates(raw, todayISO);
      console.log(
        "OUTPUT STRUCTURED:",
        JSON.stringify(
          {
            classification: resolved.classification,
            next_action: resolved.next_action,
            waiting_for_person: resolved.waiting_for_person,
            waiting_for_what: resolved.waiting_for_what,
            due_date: resolved.due_date,
            expected_date: resolved.expected_date,
            committed_date: resolved.committed_date,
            is_delegation: resolved.is_delegation,
            confidence: resolved.confidence,
            evidence: resolved.evidence,
          },
          null,
          2
        )
      );
      outcome = testCase.check(resolved) ? "AUTO PASS" : "REVIEW REQUIRED";
    } catch (err) {
      console.log(`OUTPUT STRUCTURED: ERROR - ${err instanceof Error ? err.message : String(err)}`);
      outcome = "FAILED STRUCTURE";
    }

    console.log(`RESULT: ${outcome}`);
    console.log("");

    if (outcome === "AUTO PASS") autoPass += 1;
    else if (outcome === "REVIEW REQUIRED") reviewRequired += 1;
    else failedStructure += 1;
  }

  console.log("=== RESUMEN ===");
  console.log(`TOTAL: ${CASES.length}`);
  console.log(`AUTO PASS: ${autoPass}`);
  console.log(`REVIEW REQUIRED: ${reviewRequired}`);
  console.log(`FAILED STRUCTURE: ${failedStructure}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

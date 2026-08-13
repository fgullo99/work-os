/**
 * Smoke test del AI Case Analyzer (analyzeCaseState) contra los 4 escenarios obligatorios del
 * pivot a Case (ver plan "SIMPLIFICAR ARQUITECTURA A CASES + KANBAN"). Historias sinteticas
 * (no hace falta Gmail real ni Supabase) — solo AI_PROVIDER + su API key. Mismo espiritu que
 * eval-gmail-normalizer.ts.
 *
 * El escenario 4 es el test de regresion mas importante: una delegacion ya completada, con el
 * asunto ahora esperando al cliente, NUNCA debe quedar en DELEGATED_INTERNAL (el estado actual
 * pisa la historia — ver casePrompt.ts).
 *
 * Uso: npm run eval:case-analyzer
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // ver preflight() mas abajo
}

import { getAIProvider } from "../src/lib/ai";
import type { CaseStateResult } from "../src/lib/ai/caseSchema";
import type { CaseHistoryEntry } from "../src/lib/cases/caseHistoryText";
import type { InternalTeamMember } from "../src/lib/cases/teamMembers";
import { todayInTimezone } from "../src/lib/dates/timezone";

const TEAM: InternalTeamMember[] = [
  { name: "Felipe", email: "felipe@tmcsudamerica.com.ar" },
  { name: "Thomas", email: "thomas@tmcsudamerica.com.ar" },
];

function entry(partial: Partial<CaseHistoryEntry> & Pick<CaseHistoryEntry, "direction" | "from" | "text">): CaseHistoryEntry {
  return {
    occurredAt: partial.occurredAt ?? "2026-08-10T14:00:00.000Z",
    sourceType: partial.sourceType ?? "GMAIL",
    to: partial.to ?? [],
    ...partial,
  };
}

interface Case {
  id: number;
  label: string;
  caseTitle: string;
  entries: CaseHistoryEntry[];
  expectedBehavior: string;
  check: (r: CaseStateResult) => boolean;
}

const CASES: Case[] = [
  {
    id: 1,
    label: "Delegacion ya resuelta, esperando al cliente (item 9)",
    caseTitle: "Cotización transformador",
    entries: [
      entry({ occurredAt: "2026-08-01T10:00:00.000Z", direction: "INBOUND", from: "cliente@empresa.com", to: ["felipe@tmcsudamerica.com.ar"], text: "¿Me cotizan este transformador?" }),
      entry({ occurredAt: "2026-08-01T11:00:00.000Z", direction: "OUTBOUND", from: "felipe@tmcsudamerica.com.ar", to: ["thomas@tmcsudamerica.com.ar"], text: "Thomas, prepara la oferta." }),
      entry({ occurredAt: "2026-08-02T09:00:00.000Z", direction: "OUTBOUND", from: "thomas@tmcsudamerica.com.ar", to: ["cliente@empresa.com"], text: "Buen dia, adjunto la oferta solicitada." }),
      entry({ occurredAt: "2026-08-05T09:00:00.000Z", direction: "OUTBOUND", from: "thomas@tmcsudamerica.com.ar", to: ["cliente@empresa.com"], text: "Buen dia, ¿tienen novedades sobre nuestra oferta?" }),
    ],
    expectedBehavior: "current_state=WAITING_EXTERNAL, current_owner=EXTERNAL, felipe_action_required=false",
    check: (r) => r.current_state === "WAITING_EXTERNAL" && r.current_owner === "EXTERNAL" && r.felipe_action_required === false,
  },
  {
    id: 2,
    label: "Pedido directo a Felipe (item 10)",
    caseTitle: "Fecha de entrega",
    entries: [
      entry({ occurredAt: "2026-08-10T10:00:00.000Z", direction: "INBOUND", from: "cliente@empresa.com", to: ["felipe@tmcsudamerica.com.ar"], text: "Felipe, necesito que me confirmes la fecha de entrega." }),
    ],
    expectedBehavior: "current_state=ACTION_ME, current_owner=FELIPE, felipe_action_required=true",
    check: (r) => r.current_state === "ACTION_ME" && r.current_owner === "FELIPE" && r.felipe_action_required === true,
  },
  {
    id: 3,
    label: "Delegacion todavia pendiente (item 11)",
    caseTitle: "Envio de oferta",
    entries: [
      entry({ occurredAt: "2026-08-10T10:00:00.000Z", direction: "OUTBOUND", from: "felipe@tmcsudamerica.com.ar", to: ["thomas@tmcsudamerica.com.ar"], text: "Thomas, mandale la oferta al cliente." }),
    ],
    expectedBehavior: "current_state=DELEGATED_INTERNAL, current_owner=TEAM, felipe_action_required=false",
    check: (r) => r.current_state === "DELEGATED_INTERNAL" && r.current_owner === "TEAM" && r.felipe_action_required === false,
  },
  {
    id: 4,
    label: "REGRESION — delegacion completada, ahora esperando cliente (item 12): NUNCA debe quedar DELEGATED_INTERNAL",
    caseTitle: "Envio de oferta",
    entries: [
      entry({ occurredAt: "2026-08-10T10:00:00.000Z", direction: "OUTBOUND", from: "felipe@tmcsudamerica.com.ar", to: ["thomas@tmcsudamerica.com.ar"], text: "Thomas, mandale la oferta al cliente." }),
      entry({ occurredAt: "2026-08-10T15:00:00.000Z", direction: "OUTBOUND", from: "thomas@tmcsudamerica.com.ar", to: ["felipe@tmcsudamerica.com.ar"], text: "Enviada." }),
    ],
    expectedBehavior: "current_state=WAITING_EXTERNAL (nunca DELEGATED_INTERNAL), current_owner=EXTERNAL",
    check: (r) => r.current_state === "WAITING_EXTERNAL" && r.current_owner === "EXTERNAL",
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
    console.log("CASE ANALYZER EVAL: NOT READY");
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
  let failed = 0;
  let failedStructure = 0;

  for (const testCase of CASES) {
    console.log(`=== Caso ${testCase.id}: ${testCase.label} ===`);
    for (const e of testCase.entries) {
      console.log(`  ${e.direction} de ${e.from} a [${e.to?.join(", ")}]: "${e.text}"`);
    }
    console.log(`EXPECTED: ${testCase.expectedBehavior}`);

    let outcome: "PASS" | "FAIL" | "FAILED STRUCTURE";
    try {
      const result = await provider.analyzeCaseState({
        caseTitle: testCase.caseTitle,
        referenceLabel: null,
        entries: testCase.entries,
        internalTeamMembers: TEAM,
        existing: null,
        currentDateISO: todayISO,
      });
      console.log(
        "OUTPUT:",
        JSON.stringify(
          {
            current_state: result.current_state,
            current_owner: result.current_owner,
            felipe_action_required: result.felipe_action_required,
            next_action: result.next_action,
            waiting_for: result.waiting_for,
            responsible: result.responsible,
            last_meaningful_event: result.last_meaningful_event,
            confidence: result.confidence,
            summary: result.summary,
          },
          null,
          2
        )
      );
      outcome = testCase.check(result) ? "PASS" : "FAIL";
    } catch (err) {
      console.log(`OUTPUT: ERROR - ${err instanceof Error ? err.message : String(err)}`);
      outcome = "FAILED STRUCTURE";
    }

    console.log(`RESULT: ${outcome}`);
    console.log("");

    if (outcome === "PASS") autoPass += 1;
    else if (outcome === "FAIL") failed += 1;
    else failedStructure += 1;
  }

  console.log("=== RESUMEN ===");
  console.log(`TOTAL: ${CASES.length}`);
  console.log(`PASS: ${autoPass}`);
  console.log(`FAIL: ${failed}`);
  console.log(`FAILED STRUCTURE: ${failedStructure}`);

  if (failed > 0 || failedStructure > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

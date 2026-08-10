/**
 * Smoke test del AI Normalizer contra los 10 casos obligatorios del spec.
 * SOLO depende de: AI_PROVIDER + su API key correspondiente + la timezone del
 * proyecto (America/Argentina/Buenos_Aires, hardcodeada en src/lib/dates/timezone.ts).
 * NO toca Supabase ni ninguna base de datos — deliberado, para poder correrlo
 * de forma completamente independiente de la UI/DB (ver Etapa 1, punto 5 de la
 * puesta en marcha).
 *
 * Uso: npm run eval:normalizer
 * Requiere credenciales reales de IA (consume tokens). Si faltan, este script
 * lo dice claramente y sale con exit code 1 — nunca inventa resultados.
 *
 * IMPORTANTE sobre los checks automaticos: solo validan PROPIEDADES OBJETIVAS
 * de la estructura (que campo es null y cual no) — nunca la calidad linguistica
 * de la interpretacion (si el texto extraido "suena bien", si identifico el
 * nombre correcto, etc). Un LLM puede pasar el check objetivo y aun asi haber
 * interpretado mal el detalle — por eso el resultado se llama "AUTO PASS", no
 * "CORRECTO": sigue haciendo falta una lectura humana de la salida completa.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // Sin .env.local seguimos: si AI_PROVIDER/ANTHROPIC_API_KEY ya estan seteadas
  // por otro medio (shell, CI), igual funciona. Si no estan, el preflight de
  // abajo lo va a reportar con un mensaje claro en vez de un stack trace.
}

import { getAIProvider } from "../src/lib/ai";
import type { ManualCaptureResult } from "../src/lib/ai/schema";
import { resolveDatePhrase } from "../src/lib/dates/resolveDatePhrase";
import { todayInTimezone } from "../src/lib/dates/timezone";

type ResolvedManualCaptureResult = ManualCaptureResult & {
  due_date: string | null;
  expected_date: string | null;
  committed_date: string | null;
};

function withResolvedDates(result: ManualCaptureResult, todayISO: string): ResolvedManualCaptureResult {
  return {
    ...result,
    due_date: resolveDatePhrase(result.due_date_phrase, todayISO),
    expected_date: resolveDatePhrase(result.expected_date_phrase, todayISO),
    committed_date: resolveDatePhrase(result.committed_date_phrase, todayISO),
  };
}

interface FieldExpectation {
  field: keyof ResolvedManualCaptureResult;
  expectNull: boolean;
}

interface Case {
  id: number;
  text: string;
  expectedBehavior: string;
  expectations: FieldExpectation[];
}

function notNull(field: keyof ResolvedManualCaptureResult): FieldExpectation {
  return { field, expectNull: false };
}
function isNull(field: keyof ResolvedManualCaptureResult): FieldExpectation {
  return { field, expectNull: true };
}

const CASES: Case[] = [
  {
    id: 1,
    text: "Esperando planos de Carlos para el miercoles.",
    expectedBehavior: "WAITING (waiting_for_what != null, expected_date != null)",
    expectations: [notNull("waiting_for_what"), notNull("expected_date")],
  },
  {
    id: 2,
    text: "Llamar a Juan manana por trafo 1600.",
    expectedBehavior: "ACTION (next_action != null, due_date != null)",
    expectations: [notNull("next_action"), notNull("due_date")],
  },
  {
    id: 3,
    text: "Enviar cotizacion de 2500 kVA a Techint antes del viernes.",
    expectedBehavior: "ACTION + COMMITMENT (next_action != null, due_date != null, committed_date != null)",
    expectations: [notNull("next_action"), notNull("due_date"), notNull("committed_date")],
  },
  {
    id: 4,
    text: "Estoy esperando que Nicolas revise el plano para manana.",
    expectedBehavior: "WAITING (waiting_for_what != null, expected_date != null)",
    expectations: [notNull("waiting_for_what"), notNull("expected_date")],
  },
  {
    id: 5,
    text: "Revisar precio mientras espero confirmacion de tension del cliente para el jueves.",
    expectedBehavior: "ACTION + WAITING simultaneos (next_action != null, waiting_for_what != null)",
    expectations: [notNull("next_action"), notNull("waiting_for_what")],
  },
  {
    id: 6,
    text: "Recordarme la semana que viene revisar la oferta de ABB.",
    expectedBehavior: "ACTION (next_action != null, due_date != null)",
    expectations: [notNull("next_action"), notNull("due_date")],
  },
  {
    id: 7,
    text: "Los planos deberian llegar el viernes.",
    expectedBehavior: "WAITING (waiting_for_what != null, expected_date != null)",
    expectations: [notNull("waiting_for_what"), notNull("expected_date")],
  },
  {
    id: 8,
    text: "Delegue a Nicolas revisar el plano para el martes.",
    expectedBehavior: "WAITING (waiting_for_what != null, expected_date != null)",
    expectations: [notNull("waiting_for_what"), notNull("expected_date")],
  },
  {
    id: 9,
    text: "Confirmar perdidas hoy. El cliente esta esperando.",
    expectedBehavior: "ACTION (next_action != null, due_date != null)",
    expectations: [notNull("next_action"), notNull("due_date")],
  },
  {
    id: 10,
    text: "Me llego el comprobante de pago.",
    expectedBehavior: "INFO, sin accion inventada (next_action == null, waiting_for_what == null)",
    expectations: [isNull("next_action"), isNull("waiting_for_what")],
  },

  // --- Suite 2: casos laborales realistas adicionales (11-20). NO se toca la suite 1 de arriba. ---
  {
    id: 11,
    text: "Mandale manana a Techint la alternativa en cobre del transformador de 1600 kVA.",
    expectedBehavior: "ACTION (next_action != null, due_date != null)",
    expectations: [notNull("next_action"), notNull("due_date")],
  },
  {
    id: 12,
    text: "Le pedi a Carolina que confirme el flete antes del jueves.",
    expectedBehavior: "WAITING (waiting_for_what != null, expected_date != null)",
    expectations: [notNull("waiting_for_what"), notNull("expected_date")],
  },
  {
    id: 13,
    text: "Quedamos en enviar los planos aprobados el lunes.",
    expectedBehavior: "ACTION (next_action != null, due_date != null) — compromiso propio",
    expectations: [notNull("next_action"), notNull("due_date")],
  },
  {
    id: 14,
    text: "El proveedor dijo que pasa precio la semana que viene.",
    expectedBehavior: "WAITING (waiting_for_what != null, expected_date != null)",
    expectations: [notNull("waiting_for_what"), notNull("expected_date")],
  },
  {
    id: 15,
    text: "Revisar las perdidas del trafo de 1250 kVA, pero antes necesito que Nicolas me confirme el diseno.",
    expectedBehavior: "ACTION + WAITING simultaneos (next_action != null, waiting_for_what != null) — caso critico, igual que el 5",
    expectations: [notNull("next_action"), notNull("waiting_for_what")],
  },
  {
    id: 16,
    text: "Ya envie la cotizacion a ABB. Hacer seguimiento si no contestan para el viernes.",
    expectedBehavior: "ACTION de seguimiento (next_action != null, due_date != null)",
    expectations: [notNull("next_action"), notNull("due_date")],
  },
  {
    id: 17,
    text: "Cliente aprobo los planos. No tengo nada que hacer con esto por ahora.",
    expectedBehavior: "INFO explicito, sin accion inventada (next_action == null, waiting_for_what == null)",
    expectations: [isNull("next_action"), isNull("waiting_for_what")],
  },
  {
    id: 18,
    text: "Recordame reclamarle a MBT el protocolo de ensayo pasado manana.",
    expectedBehavior: "ACTION (next_action != null, due_date != null)",
    expectations: [notNull("next_action"), notNull("due_date")],
  },
  {
    id: 19,
    text: "Carolina esta esperando que le confirme si liberamos el pedido.",
    expectedBehavior:
      "ACTION del usuario, NO waiting_for (next_action != null, waiting_for_what == null) — prueba de direccion: Carolina espera de MI, yo no espero de Carolina",
    expectations: [notNull("next_action"), isNull("waiting_for_what")],
  },
  {
    id: 20,
    text: "Nos confirmaron fecha de entrega para el 15 de septiembre.",
    expectedBehavior: "INFO, sin accion inventada (next_action == null, waiting_for_what == null)",
    expectations: [isNull("next_action"), isNull("waiting_for_what")],
  },
];

type CaseOutcome = "AUTO PASS" | "REVIEW REQUIRED" | "FAILED STRUCTURE";

function evaluate(result: ResolvedManualCaptureResult, expectations: FieldExpectation[]): boolean {
  return expectations.every((e) => (result[e.field] === null) === e.expectNull);
}

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
    console.log("NORMALIZER EVAL: NOT READY");
    console.log("");
    console.log("Falta configuracion antes de poder correr esto contra el proveedor de IA real:");
    for (const m of pre.missing) console.log(`  MISSING: ${m}`);
    console.log("");
    console.log("Corre 'npm run check:setup' para un diagnostico completo del entorno.");
    console.log("No se hizo ninguna llamada al proveedor de IA.");
    process.exit(1);
  }

  const provider = getAIProvider();
  const todayISO = todayInTimezone();
  console.log(`Fecha de referencia (hoy, America/Argentina/Buenos_Aires): ${todayISO}`);
  console.log(`AI_PROVIDER: ${process.env.AI_PROVIDER}`);
  console.log("");

  let autoPass = 0;
  let reviewRequired = 0;
  let failedStructure = 0;

  for (const testCase of CASES) {
    console.log(`=== Caso ${testCase.id} ===`);
    console.log(`INPUT: "${testCase.text}"`);
    console.log(`EXPECTED BEHAVIOR: ${testCase.expectedBehavior}`);

    let outcome: CaseOutcome;
    try {
      const raw = await provider.normalizeManualCapture({ text: testCase.text, currentDateISO: todayISO });
      const resolved = withResolvedDates(raw, todayISO);

      console.log("OUTPUT STRUCTURED:");
      console.log(
        JSON.stringify(
          {
            title: resolved.title,
            next_action: resolved.next_action,
            waiting_for_person: resolved.waiting_for_person,
            waiting_for_what: resolved.waiting_for_what,
            due_date: resolved.due_date,
            expected_date: resolved.expected_date,
            committed_date: resolved.committed_date,
            suggested_company: resolved.suggested_company,
            suggested_contact: resolved.suggested_contact,
            suggested_context: resolved.suggested_context,
            suggested_category: resolved.suggested_category,
            blocking: resolved.blocking,
            confidence: resolved.confidence,
            summary: resolved.summary,
          },
          null,
          2
        )
      );

      const pass = evaluate(resolved, testCase.expectations);
      outcome = pass ? "AUTO PASS" : "REVIEW REQUIRED";
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
  console.log("");
  console.log(
    "Esto es un smoke test, no una metrica de precision/recall. AUTO PASS confirma solo que" +
      " los campos esperados quedaron null/no-null como corresponde — revisar igual el OUTPUT" +
      " STRUCTURED de cada caso a ojo antes de confiar en la calidad de la interpretacion."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

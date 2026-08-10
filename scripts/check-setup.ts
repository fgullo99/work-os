/**
 * Valida que las variables de entorno necesarias esten presentes y tengan un
 * formato basico razonable, SIN imprimir ningun valor secreto.
 *
 * A proposito NO usa el flag `--env-file` (a diferencia de seed/eval-normalizer):
 * si .env.local no existe, este script tiene que poder decirlo de forma clara
 * en vez de que Node explote con "ENOENT: .env.local not found". Por eso carga
 * el archivo el mismo, de forma opcional, y sigue igual si no esta.
 *
 * Uso: npm run check:setup
 * Exit code 0 si todo lo requerido esta OK, 1 si falta algo.
 */

try {
  // process.loadEnvFile requiere Node 20.12+/21.7+ (ya cubierto por el Node 20.6+ pedido en el README).
  process.loadEnvFile(".env.local");
} catch {
  // Sin .env.local no es un error fatal del script: simplemente vamos a reportar
  // como MISSING todo lo que dependa de el (a menos que las vars ya esten seteadas
  // por otro medio, ej. el entorno de shell o un pipeline de CI).
}

interface CheckResult {
  label: string;
  ok: boolean;
  required: boolean;
  display: string;
  missingVarName?: string;
}

const results: CheckResult[] = [];

function checkUrl(label: string, varName: string, required: boolean): string | undefined {
  const value = process.env[varName];
  let ok = false;
  let display = "MISSING";
  if (value) {
    try {
      const parsed = new URL(value);
      ok = parsed.protocol === "http:" || parsed.protocol === "https:";
      display = ok ? "OK" : "FORMATO INVALIDO (debe ser una URL http/https)";
    } catch {
      display = "FORMATO INVALIDO (no es una URL valida)";
    }
  }
  results.push({ label, ok, required, display, missingVarName: ok ? undefined : varName });
  return value;
}

function checkNonEmpty(label: string, varName: string, required: boolean, minLength = 1): string | undefined {
  const value = process.env[varName];
  const ok = Boolean(value && value.trim().length >= minLength);
  results.push({
    label,
    ok,
    required,
    display: ok ? "OK" : value ? "FORMATO INVALIDO (muy corto)" : "MISSING",
    missingVarName: ok ? undefined : varName,
  });
  return value;
}

function checkDomain(label: string, varName: string, required: boolean): string | undefined {
  const value = process.env[varName];
  const domainRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  const ok = Boolean(value && domainRe.test(value.trim()) && !value.includes("@"));
  results.push({
    label,
    ok,
    required,
    display: ok ? "OK" : value ? "FORMATO INVALIDO (esperaba algo como 'empresa.com', sin @ ni protocolo)" : "MISSING",
    missingVarName: ok ? undefined : varName,
  });
  return value;
}

// --- Supabase (requeridos para correr la app) ---
checkUrl("SUPABASE URL", "NEXT_PUBLIC_SUPABASE_URL", true);
checkNonEmpty("SUPABASE ANON KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", true, 20);

// Opcional: solo lo usa scripts/seed.ts, la app en si no lo necesita para correr.
const serviceRoleValue = process.env.SUPABASE_SERVICE_ROLE_KEY;
results.push({
  label: "SUPABASE SERVICE ROLE KEY",
  ok: true, // nunca bloquea el check, es informativo
  required: false,
  display: serviceRoleValue && serviceRoleValue.trim().length >= 20 ? "OK" : "not set (opcional, solo hace falta para 'npm run seed')",
});

// --- Auth ---
checkDomain("ALLOWED DOMAIN", "ALLOWED_EMAIL_DOMAIN", true);
checkUrl("SITE URL", "NEXT_PUBLIC_SITE_URL", true);

// --- AI Provider ---
const SUPPORTED_PROVIDERS = ["anthropic"];
const providerValue = process.env.AI_PROVIDER;
const providerOk = Boolean(providerValue && SUPPORTED_PROVIDERS.includes(providerValue));
results.push({
  label: "AI PROVIDER",
  ok: providerOk,
  required: true,
  display: providerValue
    ? providerOk
      ? providerValue
      : `"${providerValue}" no soportado en V1 (valores validos: ${SUPPORTED_PROVIDERS.join(", ")})`
    : "MISSING",
  missingVarName: providerOk ? undefined : "AI_PROVIDER",
});

if (providerValue === "anthropic") {
  checkNonEmpty("ANTHROPIC KEY", "ANTHROPIC_API_KEY", true, 10);
}

const modelValue = process.env.ANTHROPIC_MODEL;
results.push({
  label: "ANTHROPIC MODEL",
  ok: true,
  required: false,
  display: modelValue ? modelValue : "not set (opcional, usa el default de src/lib/ai/anthropicProvider.ts)",
});

// --- Gmail (opcional para correr la app en general, pero obligatorio para usar la
// integracion de Gmail — sin esto Connect Gmail falla). No marcamos required=true porque
// V1 debe poder arrancar y usarse solo con captura manual + WhatsApp sin Gmail conectado.
function checkOptionalVar(label: string, varName: string, reason: string, minLength = 1): void {
  const value = process.env[varName];
  const ok = Boolean(value && value.trim().length >= minLength);
  results.push({
    label,
    ok: true,
    required: false,
    display: ok ? "OK" : `not set (${reason})`,
    missingVarName: ok ? undefined : varName,
  });
}
checkOptionalVar("GOOGLE CLIENT ID", "GOOGLE_CLIENT_ID", "requerido para conectar Gmail — ver README");
checkOptionalVar("GOOGLE CLIENT SECRET", "GOOGLE_CLIENT_SECRET", "requerido para conectar Gmail — ver README");
checkOptionalVar("USER EMAIL ADDRESSES", "USER_EMAIL_ADDRESSES", "requerido para conectar Gmail — ver README");
checkOptionalVar("CRON SECRET", "CRON_SECRET", "requerido para conectar Gmail — ver README", 16);

const tokenKeyValue = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
let tokenKeyDisplay = "not set (requerido para conectar Gmail — ver README)";
if (tokenKeyValue) {
  const isHex = tokenKeyValue.length === 64 && /^[0-9a-fA-F]+$/.test(tokenKeyValue);
  const decodedLength = isHex
    ? Buffer.from(tokenKeyValue, "hex").length
    : Buffer.from(tokenKeyValue, "base64").length;
  tokenKeyDisplay = decodedLength === 32 ? "OK" : `FORMATO INVALIDO (debe decodificar a 32 bytes, decodifica a ${decodedLength})`;
}
results.push({
  label: "GOOGLE TOKEN ENCRYPTION KEY",
  ok: true,
  required: false,
  display: tokenKeyDisplay,
  missingVarName: tokenKeyDisplay === "OK" ? undefined : "GOOGLE_TOKEN_ENCRYPTION_KEY",
});

// --- WhatsApp quick capture (opcional) ---
checkOptionalVar(
  "WHATSAPP CAPTURE TOKEN",
  "WHATSAPP_CAPTURE_TOKEN",
  "requerido para POST /api/capture/whatsapp (Apple Shortcut) — ver README",
  16
);

// --- Zapia (opcional) ---
checkOptionalVar(
  "ZAPIA WEBHOOK SECRET",
  "ZAPIA_WEBHOOK_SECRET",
  "requerido para POST /api/capture/zapia (webhook de Zapia) — ver README",
  16
);

// --- Salida ---
for (const r of results) {
  console.log(`${r.label}: ${r.display}`);
}

const missing = results.filter((r) => r.required && !r.ok);
if (missing.length > 0) {
  console.log("");
  for (const r of missing) {
    console.log(`MISSING: ${r.missingVarName ?? r.label}`);
  }
  console.log("");
  console.log(`Setup incompleto: ${missing.length} variable(s) requerida(s) con problemas.`);
  process.exit(1);
}

console.log("");
console.log("Setup OK: todas las variables requeridas estan presentes con formato valido.");
process.exit(0);

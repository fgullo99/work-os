/**
 * Segundo lote real del catch-up acotado, ahora con el gate ATTENTION_OWNER activo.
 * Continua desde el cursor_index donde quedo el lote anterior (resumible por diseño).
 */
try {
  process.loadEnvFile(".env.local");
} catch {}

import { createClient } from "@supabase/supabase-js";
import { getActiveConnection } from "./src/lib/google/connection";
import { runCatchupBatch } from "./src/lib/gmail/catchup";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const connection = await getActiveConnection(supabase);
  if (!connection) throw new Error("No hay conexion de Gmail activa.");

  console.log("Corriendo runCatchupBatch (UN lote: batchSize=25, timeBudgetMs=45000, days=7)...");
  const start = Date.now();
  const result = await runCatchupBatch(supabase, connection, { batchSize: 25, timeBudgetMs: 45_000, days: 7 });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\nTerminado en ${elapsed}s\n`);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  });

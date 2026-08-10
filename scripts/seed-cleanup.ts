/**
 * Borra exactamente las filas creadas por la ultima corrida de scripts/seed.ts,
 * leyendo scripts/.seed-ids.json. No toca ningun otro dato.
 *
 * Uso: npm run seed:cleanup
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const idsPath = path.join(process.cwd(), "scripts", ".seed-ids.json");

async function main() {
  if (!existsSync(idsPath)) {
    console.log("No hay scripts/.seed-ids.json — no hay nada que limpiar (o ya se limpio).");
    return;
  }

  const rows = JSON.parse(readFileSync(idsPath, "utf-8")) as { table: string; id: string }[];

  // Orden inverso al de insercion, para no romper foreign keys (source_link/work_item antes que company/contact/context).
  const reversed = [...rows].reverse();

  for (const row of reversed) {
    const { error } = await supabase.from(row.table).delete().eq("id", row.id);
    if (error) {
      console.warn(`No se pudo borrar ${row.table}/${row.id}: ${error.message}`);
    }
  }

  unlinkSync(idsPath);
  console.log(`Limpieza completa: ${rows.length} filas borradas.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

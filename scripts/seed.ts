/**
 * Crea datos de demostracion para poder ver el Dashboard con contenido real sin
 * tener que cargar todo a mano. Requiere SUPABASE_SERVICE_ROLE_KEY (bypassa RLS).
 *
 * Uso: npm run seed
 * Para borrar todo lo creado: npm run seed:cleanup
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { addDaysISO } from "../src/lib/dates/calendarMath";
import { todayInTimezone } from "../src/lib/dates/timezone";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const createdIds: { table: string; id: string }[] = [];

async function insertOne<T extends { id: string }>(table: string, values: Record<string, unknown>): Promise<T> {
  // is_demo=true en todo lo que crea este script: es lo que permite al usuario purgar
  // solo datos de demostracion (ver src/lib/admin/purgeDemo.ts) sin arriesgar datos reales.
  const { data, error } = await supabase
    .from(table)
    .insert({ ...values, is_demo: true })
    .select()
    .single();
  if (error || !data) {
    throw new Error(`No se pudo insertar en ${table}: ${error?.message ?? "sin dato devuelto"}`);
  }
  createdIds.push({ table, id: (data as T).id });
  return data as T;
}

async function main() {
  const todayISO = todayInTimezone();

  const companyA = await insertOne<{ id: string }>("company", { name: "Cliente A (Demo)" });
  const companyB = await insertOne<{ id: string }>("company", { name: "Proveedor B (Demo)" });
  const companyC = await insertOne<{ id: string }>("company", { name: "Cliente C (Demo)" });

  const contactCarlos = await insertOne<{ id: string }>("contact", {
    name: "Carlos (Demo)",
    tier: "B",
    company_id: companyB.id,
  });
  const contactA = await insertOne<{ id: string }>("contact", {
    name: "Contacto Cliente A (Demo)",
    tier: "A",
    company_id: companyA.id,
  });

  const contextA = await insertOne<{ id: string }>("context", {
    title: "Cliente A - Trafo 1600 kVA (Demo)",
    company_id: companyA.id,
  });
  const contextB = await insertOne<{ id: string }>("context", {
    title: "Proveedor B - Planos 2500 kVA (Demo)",
    company_id: companyB.id,
  });
  const contextC = await insertOne<{ id: string }>("context", {
    title: "Cliente C - Consulta tecnica (Demo)",
    company_id: companyC.id,
  });

  const item1 = await insertOne<{ id: string }>("work_item", {
    title: "Cliente A - Trafo 1600 kVA (Demo)",
    company_id: companyA.id,
    contact_id: contactA.id,
    context_id: contextA.id,
    category: "COMERCIAL",
    next_action: "Enviar cotizacion",
    due_date: todayISO,
    status: "OPEN",
  });

  const item2 = await insertOne<{ id: string }>("work_item", {
    title: "Proveedor B - Planos 2500 kVA (Demo)",
    company_id: companyB.id,
    context_id: contextB.id,
    category: "TECNICO",
    waiting_for_what: "Planos",
    waiting_for_contact_id: contactCarlos.id,
    expected_date: addDaysISO(todayISO, -2),
    blocking: true,
    blocking_note: "produccion",
    status: "OPEN",
  });

  const item3 = await insertOne<{ id: string }>("work_item", {
    title: "Cliente C - Consulta tecnica (Demo)",
    company_id: companyC.id,
    context_id: contextC.id,
    category: "TECNICO",
    next_action: "Confirmar perdidas",
    due_date: addDaysISO(todayISO, 1),
    status: "OPEN",
  });

  // Item con fuente Gmail: WAITING que todavia NO esta atrasado (item2 ya cubre el caso atrasado).
  const item4 = await insertOne<{ id: string }>("work_item", {
    title: "Proveedor B - Confirmacion tecnica (Demo)",
    company_id: companyB.id,
    context_id: contextB.id,
    category: "TECNICO",
    waiting_for_what: "Confirmacion de stock",
    waiting_for_contact_id: contactCarlos.id,
    expected_date: addDaysISO(todayISO, 3),
    status: "OPEN",
  });

  // Item con fuente WhatsApp: NO existe integracion real de WhatsApp todavia, asi que este
  // dato queda marcado como demo en el excerpt y la UI lo muestra con el sufijo "(demo)"
  // en el SourceBadge (ver WorkItemCard/AtRiskRow/WaitingForRow/RecentActivity).
  const item5 = await insertOne<{ id: string }>("work_item", {
    title: "Cliente C - Seguimiento pedido (Demo)",
    company_id: companyC.id,
    category: "OPERACIONES",
    next_action: "Confirmar fecha de entrega",
    due_date: addDaysISO(todayISO, 3),
    status: "OPEN",
  });

  const manualExcerpts: Record<string, string> = {
    [item1.id]: "Enviar cotizacion actualizada del trafo 1600 kVA a Cliente A.",
    [item2.id]: "Esperando los planos de Carlos (Proveedor B) para poder seguir con produccion.",
    [item3.id]: "Confirmar perdidas del transformador antes de responderle a Cliente C.",
  };
  for (const item of [item1, item2, item3]) {
    await insertOne("source_link", {
      work_item_id: item.id,
      source_type: "MANUAL",
      raw_excerpt: manualExcerpts[item.id],
      occurred_at: new Date().toISOString(),
    });
  }

  await insertOne("source_link", {
    work_item_id: item4.id,
    source_type: "GMAIL",
    raw_excerpt: "Te confirmo el stock disponible a mas tardar el viernes.",
    direction: "INBOUND",
    external_url: "https://mail.google.com/mail/u/0/#inbox",
    occurred_at: new Date().toISOString(),
  });

  await insertOne("source_link", {
    work_item_id: item5.id,
    source_type: "WHATSAPP",
    raw_excerpt: "Che, en que quedamos con la entrega? (Demo - WhatsApp aun no esta integrado)",
    direction: "INBOUND",
    occurred_at: new Date().toISOString(),
  });

  // Review tray: dos sugerencias pendientes (HIGH y MEDIUM) para poder ver la seccion
  // Review con contenido real sin depender de una sincronizacion de Gmail real.
  await insertOne("review_item", {
    kind: "NEW_WORK_ITEM",
    confidence: "HIGH",
    proposed_payload: {
      title: "Cliente D - Cotizacion actualizada (Demo)",
      next_action: "Enviar cotizacion actualizada",
      waiting_for_what: null,
      waiting_for_person: null,
      due_date: addDaysISO(todayISO, 5),
      expected_date: null,
      committed_date: null,
      suggested_company: "Cliente D (Demo)",
      suggested_contact: "Ana (Demo)",
      suggested_context: null,
      suggested_category: "COMERCIAL",
      blocking: false,
      is_delegation: false,
      classification: "ACTION",
    },
    rationale: "El cliente pide una cotizacion actualizada para la semana que viene.",
    evidence: "Necesitaria que me reenvien la cotizacion actualizada para la semana que viene, gracias.",
    source_type: "GMAIL",
    external_url: "https://mail.google.com/mail/u/0/#inbox",
    direction: "INBOUND",
    occurred_at: new Date().toISOString(),
  });

  await insertOne("review_item", {
    kind: "UPDATE_WORK_ITEM",
    work_item_id: item3.id,
    confidence: "MEDIUM",
    proposed_payload: {
      title: "Cliente C - Consulta tecnica (Demo)",
      next_action: "Confirmar perdidas - enviar datasheet",
      waiting_for_what: null,
      waiting_for_person: null,
      due_date: addDaysISO(todayISO, 1),
      expected_date: null,
      committed_date: null,
      suggested_company: null,
      suggested_contact: null,
      suggested_context: null,
      suggested_category: null,
      blocking: false,
      is_delegation: false,
      classification: "ACTION",
    },
    rationale: "Parece continuar el hilo de Consulta tecnica con informacion nueva.",
    evidence: "Te mando el datasheet que me pediste, avisame si falta algo.",
    source_type: "GMAIL",
    external_url: "https://mail.google.com/mail/u/0/#inbox",
    direction: "INBOUND",
    occurred_at: new Date().toISOString(),
  });

  const outPath = path.join(process.cwd(), "scripts", ".seed-ids.json");
  writeFileSync(outPath, JSON.stringify(createdIds, null, 2));

  console.log(`Seed creado: ${createdIds.length} filas.`);
  console.log("Para borrar todo: npm run seed:cleanup");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

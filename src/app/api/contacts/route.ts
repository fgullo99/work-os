import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createContact, listContacts } from "@/lib/workItems/entities";
import type { ContactTier } from "@/lib/supabase/types";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const contacts = await listContacts(supabase);
  return NextResponse.json({ ok: true, contacts });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  try {
    const contact = await createContact(supabase, {
      name,
      email: body?.email ?? null,
      phone_e164: body?.phone_e164 ?? null,
      company_id: body?.company_id ?? null,
      tier: (body?.tier as ContactTier) ?? "B",
    });
    return NextResponse.json({ ok: true, contact });
  } catch (err) {
    console.error("[contacts POST]", err);
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
  }
}

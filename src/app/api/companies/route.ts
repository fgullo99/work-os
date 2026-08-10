import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCompany, listCompanies } from "@/lib/workItems/entities";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const companies = await listCompanies(supabase);
  return NextResponse.json({ ok: true, companies });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  try {
    const company = await createCompany(supabase, { name, notes: body?.notes ?? null });
    return NextResponse.json({ ok: true, company });
  } catch (err) {
    console.error("[companies POST]", err);
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
  }
}

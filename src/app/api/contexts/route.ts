import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createContext as createContextEntity, listContexts } from "@/lib/workItems/entities";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const contexts = await listContexts(supabase);
  return NextResponse.json({ ok: true, contexts });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ ok: false, error: "missing_title" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  try {
    const context = await createContextEntity(supabase, {
      title,
      company_id: body?.company_id ?? null,
      notes: body?.notes ?? null,
    });
    return NextResponse.json({ ok: true, context });
  } catch (err) {
    console.error("[contexts POST]", err);
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
  }
}

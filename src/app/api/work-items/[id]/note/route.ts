import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addNote } from "@/lib/workItems/queries";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const noteBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!noteBody) {
    return NextResponse.json({ ok: false, error: "missing_body" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    await addNote(supabase, params.id, noteBody);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[work-items note]", err);
    return NextResponse.json({ ok: false, error: "action_failed" }, { status: 500 });
  }
}

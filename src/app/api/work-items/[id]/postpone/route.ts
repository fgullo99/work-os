import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { postponeWorkItem } from "@/lib/workItems/queries";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const until = typeof body?.until === "string" ? body.until : null;
  if (!until) {
    return NextResponse.json({ ok: false, error: "missing_until" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    const workItem = await postponeWorkItem(supabase, params.id, until);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[work-items postpone]", err);
    return NextResponse.json({ ok: false, error: "action_failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extendWaiting } from "@/lib/workItems/queries";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const expectedDate = typeof body?.expected_date === "string" ? body.expected_date : null;
  if (!expectedDate) {
    return NextResponse.json({ ok: false, error: "missing_expected_date" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    const workItem = await extendWaiting(supabase, params.id, expectedDate);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[work-items extend]", err);
    return NextResponse.json({ ok: false, error: "action_failed" }, { status: 500 });
  }
}

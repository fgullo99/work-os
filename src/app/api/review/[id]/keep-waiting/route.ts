import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { keepWaitingFromReviewCheck } from "@/lib/workItems/reviewItems";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    await keepWaitingFromReviewCheck(supabase, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[review keep-waiting]", err);
    return NextResponse.json({ ok: false, error: "keep_waiting_failed" }, { status: 500 });
  }
}

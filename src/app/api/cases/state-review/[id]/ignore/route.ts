import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ignoreCaseStateReview } from "@/lib/cases/reviewActions";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    await ignoreCaseStateReview(supabase, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[case state-review ignore]", err);
    return NextResponse.json({ ok: false, error: "ignore_failed" }, { status: 500 });
  }
}

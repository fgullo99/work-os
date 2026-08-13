import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptCaseStateReview } from "@/lib/cases/reviewActions";

/** ACCEPT de CASE_STATE_REVIEW: aplica el estado que la IA propuso, tal cual, sin volver a
 * llamar al modelo. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    const caseRow = await acceptCaseStateReview(supabase, params.id);
    return NextResponse.json({ ok: true, case: caseRow });
  } catch (err) {
    console.error("[case state-review accept]", err);
    return NextResponse.json({ ok: false, error: "accept_failed" }, { status: 500 });
  }
}

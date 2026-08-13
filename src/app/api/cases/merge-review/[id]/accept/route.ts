import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptCaseMergeReview } from "@/lib/cases/reviewActions";

/** ACCEPT de CASE_MERGE_REVIEW — body opcional { targetCaseId } si Felipe elige un candidato
 * existente; sin body, crea un Case nuevo con lo propuesto. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const supabase = createSupabaseServerClient();
  try {
    const caseRow = await acceptCaseMergeReview(supabase, params.id, body?.targetCaseId ?? null);
    return NextResponse.json({ ok: true, case: caseRow });
  } catch (err) {
    console.error("[case merge-review accept]", err);
    return NextResponse.json({ ok: false, error: "accept_failed" }, { status: 500 });
  }
}

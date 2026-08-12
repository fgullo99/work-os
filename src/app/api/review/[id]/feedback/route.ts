import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setReviewFeedback } from "@/lib/workItems/reviewItems";

const VALID_FEEDBACK = ["WRONG", "NOT_IMPORTANT", "PERSONAL"] as const;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const feedback = body?.feedback;
  if (!VALID_FEEDBACK.includes(feedback)) {
    return NextResponse.json({ ok: false, error: "invalid_feedback" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    await setReviewFeedback(supabase, params.id, feedback);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[review feedback]", err);
    return NextResponse.json({ ok: false, error: "feedback_failed" }, { status: 500 });
  }
}

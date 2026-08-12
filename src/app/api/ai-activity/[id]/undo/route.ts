import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { undoAiAction } from "@/lib/engine/undo";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    const result = await undoAiAction(supabase, params.id);
    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-activity undo]", err);
    return NextResponse.json({ ok: false, error: "undo_failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ignoreReviewItem } from "@/lib/workItems/reviewItems";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    await ignoreReviewItem(supabase, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[review ignore]", err);
    return NextResponse.json({ ok: false, error: "ignore_failed" }, { status: 500 });
  }
}

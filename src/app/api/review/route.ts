import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listPendingReviewItems } from "@/lib/workItems/reviewItems";

export async function GET() {
  const supabase = createSupabaseServerClient();
  try {
    const items = await listPendingReviewItems(supabase);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("[review GET]", err);
    return NextResponse.json({ ok: false, error: "list_failed" }, { status: 500 });
  }
}

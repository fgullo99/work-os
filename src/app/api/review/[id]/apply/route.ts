import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyUpdateToWorkItem } from "@/lib/workItems/reviewItems";

/** APPLY de kind=UPDATE_WORK_ITEM, o "Link to Existing" sobre un kind=POSSIBLE_DUPLICATE
 * (pasando targetWorkItemId en el body). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const supabase = createSupabaseServerClient();
  try {
    const workItem = await applyUpdateToWorkItem(supabase, params.id, body?.targetWorkItemId, body?.overrides);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[review apply]", err);
    return NextResponse.json({ ok: false, error: "apply_failed" }, { status: 500 });
  }
}

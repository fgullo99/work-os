import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptNewWorkItem } from "@/lib/workItems/reviewItems";

/** ACCEPT de kind=NEW_WORK_ITEM, o "Create New" sobre un kind=POSSIBLE_DUPLICATE. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const supabase = createSupabaseServerClient();
  try {
    const workItem = await acceptNewWorkItem(supabase, params.id, body?.overrides);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[review accept]", err);
    return NextResponse.json({ ok: false, error: "accept_failed" }, { status: 500 });
  }
}

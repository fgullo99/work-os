import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkItem, getWorkItemNotes, getWorkItemSources, updateWorkItem } from "@/lib/workItems/queries";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    const [workItem, sources, notes, aiActionsRes] = await Promise.all([
      getWorkItem(supabase, params.id),
      getWorkItemSources(supabase, params.id),
      getWorkItemNotes(supabase, params.id),
      supabase
        .from("ai_action_log")
        .select("id, source_type, action, confidence, reasoning, changed_fields, created_at, undone_at")
        .eq("work_item_id", params.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    return NextResponse.json({ ok: true, workItem, sources, notes, aiActions: aiActionsRes.data ?? [] });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const patch = await request.json().catch(() => null);
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    const workItem = await updateWorkItem(supabase, params.id, patch);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[work-items PATCH]", err);
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCase, getCaseSources } from "@/lib/cases/queries";

/** Case + sus fuentes (timeline) para el drawer del Kanban. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    const caseRow = await getCase(supabase, params.id);
    if (!caseRow) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const sources = await getCaseSources(supabase, params.id);
    return NextResponse.json({ ok: true, case: caseRow, sources });
  } catch (err) {
    console.error("[case get]", err);
    return NextResponse.json({ ok: false, error: "fetch_failed" }, { status: 500 });
  }
}

/** Edicion manual desde el drawer (item 36: cambiar estado/owner desde la card/drawer alcanza,
 * sin drag-and-drop). Solo los campos presentes en el body se tocan. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const supabase = createSupabaseServerClient();
  try {
    const allowed = ["current_state", "current_owner", "next_action", "waiting_for", "responsible", "due_date", "expected_date"] as const;
    const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in body) patch[key] = body[key];
    }
    const { data, error } = await supabase.from("case").update(patch).eq("id", params.id).select().single();
    if (error) throw error;
    return NextResponse.json({ ok: true, case: data });
  } catch (err) {
    console.error("[case patch]", err);
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }
}

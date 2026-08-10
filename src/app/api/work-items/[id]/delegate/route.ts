import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { delegateWorkItem } from "@/lib/workItems/queries";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const responsibleId = typeof body?.responsible_id === "string" ? body.responsible_id : null;
  const expectedDate = typeof body?.expected_date === "string" ? body.expected_date : null;

  if (!responsibleId || !expectedDate) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    const workItem = await delegateWorkItem(supabase, params.id, responsibleId, expectedDate);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[work-items delegate]", err);
    return NextResponse.json({ ok: false, error: "action_failed" }, { status: 500 });
  }
}

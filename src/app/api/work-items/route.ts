import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createWorkItem } from "@/lib/workItems/queries";
import type { CreateWorkItemInput } from "@/lib/workItems/types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<CreateWorkItemInput> | null;

  if (!body || !body.title || !body.rawText) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  try {
    const workItem = await createWorkItem(supabase, {
      title: body.title,
      context_id: body.context_id ?? null,
      company_id: body.company_id ?? null,
      contact_id: body.contact_id ?? null,
      category: body.category ?? null,
      next_action: body.next_action ?? null,
      waiting_for_what: body.waiting_for_what ?? null,
      waiting_for_contact_id: body.waiting_for_contact_id ?? null,
      due_date: body.due_date ?? null,
      expected_date: body.expected_date ?? null,
      committed_date: body.committed_date ?? null,
      blocking: body.blocking ?? false,
      blocking_note: body.blocking_note ?? null,
      estimated_minutes: body.estimated_minutes ?? null,
      ai_summary: body.ai_summary ?? null,
      ai_confidence: body.ai_confidence ?? null,
      rawText: body.rawText,
      aiOriginal: body.aiOriginal,
    });
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[work-items POST]", err);
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
  }
}

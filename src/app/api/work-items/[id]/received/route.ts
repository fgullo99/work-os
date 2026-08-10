import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { receiveWaiting } from "@/lib/workItems/queries";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    const workItem = await receiveWaiting(supabase, params.id);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[work-items received]", err);
    return NextResponse.json({ ok: false, error: "action_failed" }, { status: 500 });
  }
}

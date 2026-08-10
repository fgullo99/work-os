import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptReceivedCheck } from "@/lib/workItems/reviewItems";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    const workItem = await acceptReceivedCheck(supabase, params.id);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[review received]", err);
    return NextResponse.json({ ok: false, error: "received_failed" }, { status: 500 });
  }
}

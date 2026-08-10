import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ignoreWorkItem } from "@/lib/workItems/queries";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    const workItem = await ignoreWorkItem(supabase, params.id);
    return NextResponse.json({ ok: true, workItem });
  } catch (err) {
    console.error("[work-items ignore]", err);
    return NextResponse.json({ ok: false, error: "action_failed" }, { status: 500 });
  }
}

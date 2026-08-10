import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchWorkItems } from "@/lib/workItems/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const supabase = createSupabaseServerClient();
  try {
    const results = await searchWorkItems(supabase, q);
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[search GET]", err);
    return NextResponse.json({ ok: false, error: "search_failed" }, { status: 500 });
  }
}

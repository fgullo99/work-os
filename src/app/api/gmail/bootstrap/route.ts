import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConnectionOrThrow, runBootstrapSync } from "@/lib/gmail/sync";

const VALID_RANGES = [7, 14, 30] as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const days = body?.days;

  if (!VALID_RANGES.includes(days)) {
    return NextResponse.json({ ok: false, error: "days debe ser 7, 14 o 30" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  try {
    const connection = await getConnectionOrThrow(supabase);
    const { summary, preview } = await runBootstrapSync(supabase, connection, days as 7 | 14 | 30);
    return NextResponse.json({ ok: true, summary, preview, safeMode: connection.safe_mode });
  } catch (err) {
    console.error("[gmail bootstrap]", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "bootstrap_failed" }, { status: 500 });
  }
}

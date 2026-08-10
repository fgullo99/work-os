import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveConnection } from "@/lib/google/connection";

export async function GET() {
  const supabase = createSupabaseServerClient();
  try {
    const connection = await getActiveConnection(supabase);
    if (!connection) {
      return NextResponse.json({ ok: true, connected: false });
    }
    // Nunca devolver access_token/refresh_token al cliente.
    return NextResponse.json({
      ok: true,
      connected: true,
      needsReconnect: connection.needs_reconnect,
      lastError: connection.needs_reconnect ? connection.last_error : null,
      safeMode: connection.safe_mode,
      email: connection.email,
      bootstrapCompletedAt: connection.bootstrap_completed_at,
      bootstrapRangeDays: connection.bootstrap_range_days,
      lastSyncedAt: connection.last_synced_at,
      lastSyncSummary: connection.last_sync_summary,
    });
  } catch (err) {
    console.error("[gmail status]", err);
    return NextResponse.json({ ok: false, error: "status_failed" }, { status: 500 });
  }
}

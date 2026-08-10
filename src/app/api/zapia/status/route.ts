import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WhatsAppIngestionRow } from "@/lib/supabase/types";

export async function GET() {
  const supabase = createSupabaseServerClient();
  try {
    const configured = Boolean(process.env.ZAPIA_WEBHOOK_SECRET);

    const [lastBatchRes, lastSuccessRes, reviewPendingRes, errorsRes] = await Promise.all([
      supabase.from("whatsapp_ingestion").select("*").order("received_at", { ascending: false }).limit(1).maybeSingle(),
      supabase
        .from("whatsapp_ingestion")
        .select("processed_at")
        .eq("status", "PROCESSED")
        .order("processed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("review_item")
        .select("*", { count: "exact", head: true })
        .eq("source_type", "WHATSAPP")
        .eq("raw_metadata->>provider", "zapia")
        .eq("status", "PENDING"),
      supabase.from("whatsapp_ingestion").select("*", { count: "exact", head: true }).eq("status", "ERROR"),
    ]);

    if (lastBatchRes.error) throw lastBatchRes.error;
    if (lastSuccessRes.error) throw lastSuccessRes.error;
    if (reviewPendingRes.error) throw reviewPendingRes.error;
    if (errorsRes.error) throw errorsRes.error;

    const lastBatch = lastBatchRes.data as WhatsAppIngestionRow | null;

    return NextResponse.json({
      ok: true,
      configured,
      lastBatch: lastBatch
        ? {
            batchId: lastBatch.batch_id,
            receivedAt: lastBatch.received_at,
            status: lastBatch.status,
            messageCount: lastBatch.message_count,
          }
        : null,
      lastSuccessfulSync: (lastSuccessRes.data as { processed_at: string } | null)?.processed_at ?? null,
      reviewPending: reviewPendingRes.count ?? 0,
      errors: errorsRes.count ?? 0,
    });
  } catch (err) {
    console.error("[zapia status]", err);
    return NextResponse.json({ ok: false, error: "status_failed" }, { status: 500 });
  }
}

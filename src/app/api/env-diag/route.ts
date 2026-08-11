import { NextResponse } from "next/server";

/** Diagnostico temporal: confirma presencia/largo de env vars server-only sin exponer
 * valores. Borrar despues de usarlo. */
export async function GET() {
  const names = [
    "CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
    "WHATSAPP_CAPTURE_TOKEN",
    "ZAPIA_WEBHOOK_SECRET",
    "USER_EMAIL_ADDRESSES",
    "ALLOWED_EMAIL_DOMAIN",
    "AI_PROVIDER",
  ];
  const report: Record<string, { present: boolean; length: number }> = {};
  for (const name of names) {
    const value = process.env[name];
    report[name] = { present: Boolean(value), length: value?.length ?? 0 };
  }
  return NextResponse.json(report);
}

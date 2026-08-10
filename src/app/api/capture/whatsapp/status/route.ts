import { NextResponse } from "next/server";

/** Solo informa si el servidor tiene el token configurado — nunca devuelve el valor. */
export async function GET() {
  return NextResponse.json({ ok: true, configured: Boolean(process.env.WHATSAPP_CAPTURE_TOKEN) });
}

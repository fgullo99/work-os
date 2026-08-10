import { NextResponse } from "next/server";
import { AINormalizationError, getAIProvider } from "@/lib/ai";
import { resolveDatePhrase } from "@/lib/dates/resolveDatePhrase";
import { todayInTimezone } from "@/lib/dates/timezone";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ ok: false, error: "missing_text" }, { status: 400 });
  }

  const todayISO = todayInTimezone();

  try {
    const provider = getAIProvider();
    const result = await provider.normalizeManualCapture({ text, currentDateISO: todayISO });

    return NextResponse.json({
      ok: true,
      todayISO,
      result: {
        ...result,
        due_date: resolveDatePhrase(result.due_date_phrase, todayISO),
        expected_date: resolveDatePhrase(result.expected_date_phrase, todayISO),
        committed_date: resolveDatePhrase(result.committed_date_phrase, todayISO),
      },
    });
  } catch (err) {
    console.error("[capture/normalize]", err);
    const message =
      err instanceof AINormalizationError
        ? "No pude interpretar esto con suficiente confianza."
        : "Error inesperado al interpretar el texto.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

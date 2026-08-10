import type { gmail_v1 } from "googleapis";
import type { SourceDirection } from "@/lib/supabase/types";
import type { NormalizedMessage, NormalizedThread } from "./types";

const MAX_BODY_CHARS = 4000;

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBase64Url(plain.body.data);
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }
  return "";
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseEmailList(headerVal: string): string[] {
  if (!headerVal) return [];
  return headerVal
    .split(",")
    .map((s) => {
      const match = s.match(/<([^>]+)>/);
      return (match?.[1] ?? s).trim().toLowerCase();
    })
    .filter(Boolean);
}

function extractFromName(headerVal: string): string | null {
  const match = headerVal.match(/^"?([^"<]*)"?\s*<[^>]+>$/);
  const name = match?.[1]?.trim();
  return name || null;
}

/** INBOUND/OUTBOUND se decide comparando el remitente contra USER_EMAIL_ADDRESSES. */
export function determineDirection(fromEmail: string, userAddresses: string[]): SourceDirection {
  const normalized = fromEmail.toLowerCase();
  return userAddresses.some((addr) => addr.toLowerCase() === normalized) ? "OUTBOUND" : "INBOUND";
}

export function parseThread(raw: gmail_v1.Schema$Thread, userAddresses: string[]): NormalizedThread {
  const rawMessages = raw.messages ?? [];

  const messages: NormalizedMessage[] = rawMessages
    .map((m) => {
      const headers = m.payload?.headers;
      const fromHeader = headerValue(headers, "From");
      const fromEmail = parseEmailList(fromHeader)[0] ?? "";
      const listUnsubscribe = headerValue(headers, "List-Unsubscribe");
      const body = extractBody(m.payload).slice(0, MAX_BODY_CHARS);

      const message: NormalizedMessage = {
        id: m.id ?? "",
        direction: determineDirection(fromEmail, userAddresses),
        from: fromEmail,
        fromName: extractFromName(fromHeader),
        to: parseEmailList(headerValue(headers, "To")),
        cc: parseEmailList(headerValue(headers, "Cc")),
        subject: headerValue(headers, "Subject"),
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
        snippet: m.snippet ?? "",
        bodyText: body,
        hasListUnsubscribe: Boolean(listUnsubscribe),
      };
      return message;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const subject = messages[0]?.subject || "(sin asunto)";

  return {
    threadId: raw.id ?? "",
    historyId: raw.historyId ?? null,
    messages,
    subject,
    webUrl: `https://mail.google.com/mail/u/0/#all/${raw.id}`,
  };
}

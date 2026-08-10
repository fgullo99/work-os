import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export function getGmailApi(auth: OAuth2Client): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth });
}

/** Se lanza cuando el historyId guardado ya no es valido en Gmail (suele pasar si pasaron
 * demasiados dias sin sincronizar). Señal de que hace falta recalcular el cursor. */
export class HistoryExpiredError extends Error {
  constructor() {
    super("El historyId guardado ya no es valido en Gmail — hace falta resincronizar el cursor.");
    this.name = "HistoryExpiredError";
  }
}

/** Bootstrap: junta ids de threads dentro de una ventana de dias, usando el operador `after:`. */
export async function listThreadIdsSinceDays(gmail: gmail_v1.Gmail, days: number): Promise<string[]> {
  const afterUnixSeconds = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.threads.list({
      userId: "me",
      q: `after:${afterUnixSeconds}`,
      pageToken,
      maxResults: 100,
    });
    for (const t of res.data.threads ?? []) {
      if (t.id) ids.push(t.id);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

/** Incremental: junta threadIds que tuvieron mensajes nuevos desde el ultimo historyId conocido. */
export async function listChangedThreadIdsSinceHistory(
  gmail: gmail_v1.Gmail,
  startHistoryId: string
): Promise<{ threadIds: string[]; newHistoryId: string | null }> {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;
  let newHistoryId: string | null = null;

  try {
    do {
      const res = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        pageToken,
        maxResults: 100,
      });
      for (const h of res.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.threadId) threadIds.add(added.message.threadId);
        }
      }
      if (res.data.historyId) newHistoryId = res.data.historyId;
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.code ?? (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) throw new HistoryExpiredError();
    throw err;
  }

  return { threadIds: [...threadIds], newHistoryId };
}

export async function getThread(gmail: gmail_v1.Gmail, threadId: string): Promise<gmail_v1.Schema$Thread> {
  const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  return res.data;
}

export async function getCurrentHistoryId(gmail: gmail_v1.Gmail): Promise<string | null> {
  const res = await gmail.users.getProfile({ userId: "me" });
  return res.data.historyId ?? null;
}

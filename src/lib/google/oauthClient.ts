import { google } from "googleapis";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { markNeedsReconnect } from "./connection";
import { decryptToken, encryptToken } from "./tokenCrypto";
import type { GoogleConnectionRow } from "@/lib/supabase/types";

export { GMAIL_READONLY_SCOPE } from "./constants";

/** Google devuelve este codigo en el body del error cuando el refresh_token ya no sirve
 * (revocado desde myaccount.google.com/permissions, password cambiada, etc). No hay forma
 * de recuperarse sin que el usuario vuelva a autorizar — de ahi needs_reconnect. */
export function isInvalidGrantError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes("invalid_grant");
}

interface RawTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}

/**
 * Decide que campos de google_connection actualizar a partir del evento 'tokens' del
 * OAuth2Client. Pura a proposito (recibe `encrypt` inyectado) para poder testear la regla
 * "si Google no manda refresh_token nuevo, no tocar el guardado" sin depender de la clave
 * de cifrado real ni de un OAuth2Client de verdad.
 */
export function buildTokenUpdate(tokens: RawTokens, encrypt: (plaintext: string) => string): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (tokens.access_token) update.access_token = encrypt(tokens.access_token);
  // Google no siempre rota el refresh_token; si no viene uno nuevo, conservamos el actual.
  if (tokens.refresh_token) update.refresh_token = encrypt(tokens.refresh_token);
  if (tokens.expiry_date) update.token_expires_at = new Date(tokens.expiry_date).toISOString();
  return update;
}

/**
 * Por que este cliente existe aparte del login de Supabase:
 *
 * Supabase Auth usa SUS PROPIAS credenciales de Google OAuth (configuradas en el
 * Dashboard de Supabase) para el login normal, y solo expone el access_token/refresh_token
 * de Google UNA VEZ, en la respuesta inmediata del intercambio de codigo — no los guarda
 * para uso posterior. El sync de Gmail corre en background (disparado por cron, sin sesion
 * de usuario), asi que necesitamos poder refrescar el access_token nosotros mismos.
 *
 * Eso requiere el MISMO client_id/client_secret que emitio el refresh_token. Como quien
 * configura el provider de Google en Supabase es el propio desarrollador de esta app, esas
 * credenciales estan disponibles: son las mismas que se pegan en Supabase Dashboard >
 * Authentication > Providers > Google, copiadas tambien a GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
 * en el entorno de esta app.
 */
function buildOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en las variables de entorno.");
  }
  return new google.auth.OAuth2(clientId, clientSecret);
}

/**
 * Devuelve un OAuth2Client con un access_token valido para la conexion dada. Si esta
 * vencido o por vencer, lo refresca contra Google y persiste el resultado en
 * google_connection antes de devolverlo.
 */
export async function getAuthorizedGmailClient(connection: GoogleConnectionRow) {
  const client = buildOAuth2Client();
  client.setCredentials({
    access_token: decryptToken(connection.access_token),
    refresh_token: decryptToken(connection.refresh_token),
    expiry_date: new Date(connection.token_expires_at).getTime(),
  });

  client.on("tokens", (tokens) => {
    const update = buildTokenUpdate(tokens, encryptToken);
    if (Object.keys(update).length === 0) return;

    createSupabaseServiceClient()
      .from("google_connection")
      .update(update)
      .eq("id", connection.id)
      .then(({ error }) => {
        if (error) console.error("[gmail oauth] no se pudo persistir el token refrescado:", error.message);
      });
  });

  const expiresInMs = new Date(connection.token_expires_at).getTime() - Date.now();
  if (expiresInMs < 2 * 60 * 1000) {
    try {
      // Fuerza el refresh (dispara el listener 'tokens' de arriba, que persiste el resultado).
      await client.getAccessToken();
    } catch (err) {
      if (isInvalidGrantError(err)) {
        const message = err instanceof Error ? err.message : "invalid_grant";
        await markNeedsReconnect(createSupabaseServiceClient(), connection.id, message);
        throw new Error("Gmail needs reconnect: el refresh token ya no es valido.");
      }
      throw err;
    }
  }

  return client;
}

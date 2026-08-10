import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveConnection } from "@/lib/google/connection";
import { GMAIL_READONLY_SCOPE } from "@/lib/google/oauthClient";

/**
 * Callback dedicado para el paso "Conectar Gmail" (distinto de /auth/callback, que es
 * el login normal). La diferencia importante: aca leemos session.provider_token /
 * session.provider_refresh_token — Supabase los expone SOLO en esta respuesta inmediata
 * despues del intercambio de codigo, nunca de nuevo despues. Si no llega
 * provider_refresh_token, típicamente es porque el consentimiento no incluyo
 * access_type=offline+prompt=consent (ver el boton "Conectar Gmail" en Settings).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/settings?gmail_error=missing_code`);
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/settings?gmail_error=auth_failed`);
  }

  const providerToken = data.session.provider_token;
  const providerRefreshToken = data.session.provider_refresh_token;
  const email = data.session.user.email;

  if (!providerToken || !providerRefreshToken || !email) {
    return NextResponse.redirect(`${origin}/settings?gmail_error=missing_tokens`);
  }

  // Google no siempre informa el expires_in exacto en este objeto; asumimos el default de
  // access tokens de Google (1 hora) si no viene, y el refresh temprano en oauthClient.ts
  // (2 min de margen) cubre cualquier imprecision.
  const expiresInSeconds = 3600;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  try {
    await saveConnection(supabase, {
      email,
      accessToken: providerToken,
      refreshToken: providerRefreshToken,
      expiresAt,
      scope: GMAIL_READONLY_SCOPE,
    });
  } catch (err) {
    console.error("[gmail-callback] no se pudo guardar la conexion:", err);
    return NextResponse.redirect(`${origin}/settings?gmail_error=save_failed`);
  }

  return NextResponse.redirect(`${origin}/settings?gmail=connected`);
}

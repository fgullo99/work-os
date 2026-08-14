import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATH_PREFIXES = ["/login", "/auth"];

// Rutas que hacen SU PROPIO chequeo de autorizacion adentro (no dependen de la sesion de
// cookies) y por eso no deben caer en el 401 generico de abajo: el sync de Gmail (cron
// externo, autentica con CRON_SECRET), la captura rapida de WhatsApp (Apple Shortcut sin
// sesion de navegador, autentica con WHATSAPP_CAPTURE_TOKEN) y el webhook de Zapia (autentica
// con ZAPIA_WEBHOOK_SECRET) — ver los route handlers respectivos para el chequeo real.
// Nota: por el startsWith de abajo, "/api/capture/whatsapp/status" tambien queda exento del
// gate de sesion (es prefijo de "/api/capture/whatsapp") — inofensivo, esa ruta solo
// devuelve un boolean ("esta configurado o no"), nunca datos sensibles.
const SELF_AUTH_PATHS = ["/api/gmail/sync", "/api/cases/sync", "/api/capture/whatsapp", "/api/capture/zapia", "/api/reconcile"];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p)) || SELF_AUTH_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirectTo", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

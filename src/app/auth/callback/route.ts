import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Unico punto donde se aplica la restriccion de dominio de Google Workspace.
 * Supabase Auth por si solo no restringe por dominio: cualquier cuenta de Google
 * puede completar el OAuth. Aca verificamos el email despues del intercambio de
 * codigo y, si no matchea ALLOWED_EMAIL_DOMAIN, cerramos la sesion inmediatamente.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const email = data.session.user.email ?? "";
  const domain = email.split("@")[1]?.toLowerCase();
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase();

  if (allowedDomain && domain !== allowedDomain) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}

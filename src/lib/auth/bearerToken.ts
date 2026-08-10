/** Compara el header Authorization contra un token estatico esperado (patron ya usado por
 * CRON_SECRET en /api/gmail/sync). Pura: no lee env vars ni request — el caller decide de
 * donde sale cada valor, lo que la hace facil de testear. */
export function isAuthorizedBearer(authHeader: string | null, expectedToken: string | undefined | null): boolean {
  if (!expectedToken) return false;
  return authHeader === `Bearer ${expectedToken}`;
}

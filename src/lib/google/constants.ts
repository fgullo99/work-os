/**
 * Constantes sin dependencias de Node (safe para importar desde Client Components).
 * oauthClient.ts importa `googleapis`, que es Node-only y no debe llegar nunca al bundle
 * del browser — por eso este valor vive en un archivo aparte.
 */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

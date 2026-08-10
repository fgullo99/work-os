import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado application-side de los tokens de Google (access_token/refresh_token) antes de
 * persistirlos en google_connection. AES-256-GCM (cifrado autenticado): un IV/nonce random
 * de 12 bytes por valor + auth tag, para que un valor cifrado nunca se pueda alterar sin
 * que decryptToken() lo detecte y falle.
 *
 * Formato guardado en DB: "v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>".
 * El prefijo de version es la unica concesion a "rotacion futura de clave" que vale la pena
 * hacer ahora sin sobreingenieria: el dia que haga falta rotar, se agrega un case "v2" en
 * decryptToken() que use una segunda variable de entorno (ej. GOOGLE_TOKEN_ENCRYPTION_KEY_V2)
 * y se empieza a escribir "v2:..." en encryptToken() — los valores "v1:..." existentes se
 * siguen pudiendo leer mientras no se retire la key vieja. No hace falta mas que eso para V1.
 */

const ALGORITHM = "aes-256-gcm";
const CURRENT_VERSION = "v1";
const IV_LENGTH_BYTES = 12; // largo recomendado para GCM

function loadKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Falta GOOGLE_TOKEN_ENCRYPTION_KEY en las variables de entorno.");
  }
  // Acepta hex (64 caracteres) o base64 — lo que sea mas comodo de generar
  // (ej. `openssl rand -hex 32` o `openssl rand -base64 32`).
  const isHex = raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw);
  const key = isHex ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `GOOGLE_TOKEN_ENCRYPTION_KEY debe decodificar a exactamente 32 bytes (256 bits); decodifico a ${key.length}.`
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [CURRENT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new Error("Formato de token cifrado invalido (se esperaban 4 partes separadas por ':').");
  }
  const [version, ivB64, authTagB64, ciphertextB64] = parts as [string, string, string, string];
  if (version !== CURRENT_VERSION) {
    throw new Error(`Version de cifrado no soportada: "${version}".`);
  }

  const key = loadKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Si la clave es incorrecta o el valor fue alterado, esto tira (GCM es cifrado
  // autenticado) — nunca devuelve datos corruptos silenciosamente.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

import { describe, expect, it, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "./tokenCrypto";

const VALID_KEY_HEX = "0".repeat(63) + "1"; // 64 hex chars = 32 bytes
const OTHER_KEY_HEX = "0".repeat(63) + "2";

describe("tokenCrypto", () => {
  beforeAll(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = VALID_KEY_HEX;
  });

  it("roundtrips a plaintext token through encrypt/decrypt", () => {
    const plaintext = "ya29.a0Ael9sCsomeFakeAccessTokenValue";
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-plaintext-token";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it("stores the versioned v1:<iv>:<authTag>:<ciphertext> format", () => {
    const encrypted = encryptToken("abc");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptToken("secret-value");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = OTHER_KEY_HEX;
    expect(() => decryptToken(encrypted)).toThrow();
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = VALID_KEY_HEX;
  });

  it("fails to decrypt tampered ciphertext (authenticated encryption)", () => {
    const encrypted = encryptToken("secret-value");
    const parts = encrypted.split(":");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered-ciphertext").toString("base64")].join(":");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws when GOOGLE_TOKEN_ENCRYPTION_KEY is missing", () => {
    const original = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow();
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = original;
  });

  it("rejects a key that does not decode to 32 bytes", () => {
    const original = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "tooshort";
    expect(() => encryptToken("x")).toThrow();
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = original;
  });
});

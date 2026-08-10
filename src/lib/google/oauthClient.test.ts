import { describe, expect, it } from "vitest";
import { buildTokenUpdate, isInvalidGrantError } from "./oauthClient";

const identity = (s: string) => `ENC(${s})`;

describe("buildTokenUpdate", () => {
  it("includes access_token, refresh_token and expiry when all are present", () => {
    const update = buildTokenUpdate(
      { access_token: "new-access", refresh_token: "new-refresh", expiry_date: 1_700_000_000_000 },
      identity
    );
    expect(update.access_token).toBe("ENC(new-access)");
    expect(update.refresh_token).toBe("ENC(new-refresh)");
    expect(update.token_expires_at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("preserves the existing refresh_token when Google does not send a new one", () => {
    const update = buildTokenUpdate({ access_token: "new-access", expiry_date: 1_700_000_000_000 }, identity);
    expect(update.access_token).toBe("ENC(new-access)");
    expect(update).not.toHaveProperty("refresh_token");
  });

  it("returns an empty object when there is nothing to update", () => {
    const update = buildTokenUpdate({}, identity);
    expect(Object.keys(update)).toHaveLength(0);
  });
});

describe("isInvalidGrantError", () => {
  it("detects invalid_grant errors case-insensitively", () => {
    expect(isInvalidGrantError(new Error("invalid_grant: Token has been expired or revoked."))).toBe(true);
    expect(isInvalidGrantError(new Error("INVALID_GRANT"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isInvalidGrantError(new Error("network timeout"))).toBe(false);
    expect(isInvalidGrantError("invalid_grant")).toBe(false);
    expect(isInvalidGrantError(null)).toBe(false);
  });
});

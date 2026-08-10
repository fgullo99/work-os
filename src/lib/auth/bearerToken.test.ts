import { describe, expect, it } from "vitest";
import { isAuthorizedBearer } from "./bearerToken";

describe("isAuthorizedBearer", () => {
  it("accepts a matching bearer header", () => {
    expect(isAuthorizedBearer("Bearer secret-123", "secret-123")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedBearer(null, "secret-123")).toBe(false);
  });

  it("rejects a mismatched token", () => {
    expect(isAuthorizedBearer("Bearer wrong-token", "secret-123")).toBe(false);
  });

  it("rejects when no token is configured server-side, even with a header present", () => {
    expect(isAuthorizedBearer("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedBearer("Bearer anything", "")).toBe(false);
  });

  it("rejects a header missing the 'Bearer ' prefix", () => {
    expect(isAuthorizedBearer("secret-123", "secret-123")).toBe(false);
  });
});

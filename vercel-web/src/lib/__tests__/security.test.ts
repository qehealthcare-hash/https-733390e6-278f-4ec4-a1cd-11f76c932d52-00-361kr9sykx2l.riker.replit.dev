import { describe, expect, it, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  hasBlockedUploadExtension,
  timingSafeEqualString
} from "@/lib/api/security";
import { jsonError } from "@/lib/api/errors";

describe("security helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("timingSafeEqualString matches equal secrets only", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "abcd")).toBe(false);
  });

  it("checkRateLimit enforces window limits", () => {
    const key = "test-" + Date.now();
    expect(checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000)).toBe(true);
    expect(checkRateLimit(key, 2, 60_000)).toBe(false);
  });

  it("blocks risky upload extensions", () => {
    expect(hasBlockedUploadExtension("proof.html")).toBe(true);
    expect(hasBlockedUploadExtension("scan.pdf")).toBe(false);
    expect(hasBlockedUploadExtension("photo.jpg")).toBe(false);
  });

  it("jsonError hides internal exception text in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await jsonError(new Error("database connection string leaked"));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(String(body.error)).not.toContain("leaked");
  });
});

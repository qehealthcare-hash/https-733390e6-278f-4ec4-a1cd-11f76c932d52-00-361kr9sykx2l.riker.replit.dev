import { describe, expect, it } from "vitest";
import { PERMISSIONS_POLICY } from "@/lib/api/securityHeaders";

describe("securityHeaders", () => {
  it("allows camera on same origin for document capture", () => {
    expect(PERMISSIONS_POLICY).toMatch(/camera=\(self\)/i);
    expect(PERMISSIONS_POLICY).toMatch(/microphone=\(\)/i);
  });
});

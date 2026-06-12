import { describe, expect, it } from "vitest";
import { sanitizeForLlm } from "@/services/aiPhiSanitizer";

describe("sanitizeForLlm", () => {
  it("redacts email and mobile fields", () => {
    const out = sanitizeForLlm({
      email: "care@example.com",
      mobile: "9876543210",
      name: "Ramesh"
    }) as Record<string, unknown>;
    expect(out.email).toBe("[redacted]");
    expect(out.mobile).toBe("[redacted]");
    expect(out.name).toBe("Ramesh");
  });
});

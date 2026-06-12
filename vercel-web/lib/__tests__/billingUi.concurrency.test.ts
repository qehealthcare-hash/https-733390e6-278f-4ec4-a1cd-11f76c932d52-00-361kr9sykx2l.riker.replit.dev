import { describe, expect, it } from "vitest";
import {
  apiErrorMessage,
  billingExpectedUpdatedAt,
  isApiConflictError
} from "@/lib/billingUi";

describe("billingUi concurrency helpers", () => {
  it("reads updated_at from bundle billing row", () => {
    expect(
      billingExpectedUpdatedAt({
        billing: { id: "B1", updated_at: "2026-06-01T00:00:00.000Z" }
      } as never)
    ).toBe("2026-06-01T00:00:00.000Z");
  });

  it("detects conflict errors by code", () => {
    expect(isApiConflictError({ code: "conflict", message: "stale" })).toBe(true);
    expect(isApiConflictError(new Error("nope"))).toBe(false);
  });

  it("extracts API error messages", () => {
    expect(apiErrorMessage({ message: "Bill was modified" }, "fallback")).toBe(
      "Bill was modified"
    );
    expect(apiErrorMessage(null, "fallback")).toBe("fallback");
  });
});

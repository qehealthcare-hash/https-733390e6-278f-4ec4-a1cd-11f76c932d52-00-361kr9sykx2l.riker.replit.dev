import { describe, expect, it } from "vitest";
import { apiErrorMessage, isApiConflictError } from "@/lib/apiClientErrors";

describe("apiClientErrors", () => {
  it("detects conflict errors by code", () => {
    expect(isApiConflictError({ code: "conflict" })).toBe(true);
    expect(isApiConflictError({ code: "validation_error" })).toBe(false);
  });

  it("extracts API error messages", () => {
    expect(apiErrorMessage({ message: "stale row" }, "fallback")).toBe("stale row");
    expect(apiErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});

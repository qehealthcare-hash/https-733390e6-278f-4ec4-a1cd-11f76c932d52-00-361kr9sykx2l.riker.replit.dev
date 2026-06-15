import { describe, expect, it } from "vitest";
import { CONTRACT_ERROR_CODE } from "@/lib/api-client";
import { apiErrorMessage, isApiConflictError, isApiContractError } from "@/lib/apiClientErrors";

describe("apiClientErrors", () => {
  it("detects contract errors by code", () => {
    expect(isApiContractError({ code: CONTRACT_ERROR_CODE })).toBe(true);
    expect(isApiContractError({ code: "conflict" })).toBe(false);
  });

  it("detects conflict errors by code", () => {
    expect(isApiConflictError({ code: "conflict" })).toBe(true);
    expect(isApiConflictError({ code: "validation_error" })).toBe(false);
  });

  it("extracts API error messages", () => {
    expect(apiErrorMessage({ message: "stale row" }, "fallback")).toBe("stale row");
    expect(apiErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});

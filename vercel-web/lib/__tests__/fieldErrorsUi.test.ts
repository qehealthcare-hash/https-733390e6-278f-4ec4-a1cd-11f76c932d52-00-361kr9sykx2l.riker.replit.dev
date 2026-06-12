import { describe, expect, it } from "vitest";
import {
  collectFieldMessages,
  fieldErrorElementId,
  fieldInputAriaProps,
  parseValidationFieldErrors
} from "@/lib/fieldErrorsUi";

describe("fieldErrorsUi (P2-9)", () => {
  it("parses validation_error details", () => {
    const parsed = parseValidationFieldErrors({
      code: "validation_error",
      details: {
        fieldErrors: { phone: ["mobile is required"] },
        formErrors: ["Check the form"]
      }
    });
    expect(parsed?.fields.phone).toEqual(["mobile is required"]);
    expect(parsed?.form).toEqual(["Check the form"]);
  });

  it("merges alias keys for API vs form field names", () => {
    const msgs = collectFieldMessages({ phone: ["mobile is required"] }, "mobile", ["phone"]);
    expect(msgs).toEqual(["mobile is required"]);
  });

  it("exposes aria-invalid and describedby when messages exist", () => {
    const aria = fieldInputAriaProps("employees", "aadhar", { aadhar: ["Aadhar must be exactly 12 digits"] });
    expect(aria.inputProps["aria-invalid"]).toBe(true);
    expect(aria.inputProps["aria-describedby"]).toBe(fieldErrorElementId("employees", "aadhar"));
    expect(aria.messages[0]).toMatch(/12 digits/);
  });

  it("omits aria props when there is no error", () => {
    const aria = fieldInputAriaProps("employees", "pan", {});
    expect(aria.inputProps["aria-invalid"]).toBeUndefined();
    expect(aria.inputProps["aria-describedby"]).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseInput, parseOutput } from "@/validation/parseValidation";

/**
 * `parseInput` is the single chokepoint every service uses to turn unknown
 * request bodies into validated input. The default "Validation failed" string
 * is unhelpful to operators looking at a form — these tests lock in a
 * human-readable, field-aware summary so the UI can show *which* field is
 * wrong instead of just refusing the save.
 */
describe("parseInput — human-readable error summary", () => {
  it("returns a per-field summary message when validation fails", () => {
    const schema = z.object({
      fn: z.string().min(1, "name is required"),
      phone: z.string().min(10, "mobile must contain at least 10 digits")
    });
    const result = parseInput(schema, { fn: "", phone: "12" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("fn: name is required");
    expect(result.error).toContain("phone: mobile must contain at least 10 digits");
    expect(result.code).toBe("validation_error");
  });

  it("ships the Zod flatten shape in `details` so the client can render per-field hints", () => {
    const schema = z.object({ aadhar: z.string().length(12, "Aadhar must be exactly 12 digits") });
    const result = parseInput(schema, { aadhar: "123" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const details = result.details as {
      fieldErrors: Record<string, string[]>;
      formErrors: string[];
    };
    expect(details.fieldErrors.aadhar).toEqual(["Aadhar must be exactly 12 digits"]);
    expect(details.formErrors).toEqual([]);
  });

  it("truncates very long error lists with a clear overflow hint", () => {
    const schema = z.object({
      a: z.string().min(1, "a required"),
      b: z.string().min(1, "b required"),
      c: z.string().min(1, "c required"),
      d: z.string().min(1, "d required"),
      e: z.string().min(1, "e required")
    });
    const result = parseInput(schema, { a: "", b: "", c: "", d: "", e: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/\(\+\d+ more\)$/);
  });

  it("surfaces form-level (cross-field) errors in the message", () => {
    const schema = z
      .object({ start: z.string(), end: z.string() })
      .refine((v) => v.end >= v.start, { message: "end must be after start" });
    const result = parseInput(schema, { start: "2026-05-10", end: "2026-05-01" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("end must be after start");
  });

  it("returns success unchanged for valid input", () => {
    const schema = z.object({ name: z.string() });
    const result = parseInput(schema, { name: "ok" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ name: "ok" });
  });
});

describe("parseOutput — wire contract validation", () => {
  it("returns internal_error when output drifts from schema", () => {
    const schema = z.object({ total: z.number() });
    const result = parseOutput(schema, { total: "not-a-number" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("internal_error");
  });

  it("returns parsed data on success", () => {
    const schema = z.object({ period: z.string(), pending: z.number() });
    const result = parseOutput(schema, { period: "2026-05", pending: 0 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pending).toBe(0);
  });
});

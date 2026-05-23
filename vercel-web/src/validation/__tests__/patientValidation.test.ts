import { describe, expect, it } from "vitest";
import { patientCloseSchema } from "@/validation/patientValidation";

describe("patientCloseSchema — DELETE /patients/:id body", () => {
  it("accepts a bare empty body (backwards-compatible)", () => {
    const parsed = patientCloseSchema.parse({});
    expect(parsed.reason).toBe("");
    expect(parsed.reason_other).toBe("");
  });

  it("trims and forwards a plain reason", () => {
    const parsed = patientCloseSchema.parse({ reason: "  Discharged  " });
    expect(parsed.reason).toBe("Discharged");
    expect(parsed.reason_other).toBe("");
  });

  it("forwards both fields when reason is Other", () => {
    const parsed = patientCloseSchema.parse({
      reason: "Other",
      reason_other: "Family relocated to Bengaluru"
    });
    expect(parsed.reason).toBe("Other");
    expect(parsed.reason_other).toBe("Family relocated to Bengaluru");
  });

  it("rejects oversized reason strings", () => {
    const long = "x".repeat(121);
    expect(() => patientCloseSchema.parse({ reason: long })).toThrow();
  });

  it("rejects oversized reason_other strings", () => {
    const long = "x".repeat(501);
    expect(() => patientCloseSchema.parse({ reason_other: long })).toThrow();
  });
});

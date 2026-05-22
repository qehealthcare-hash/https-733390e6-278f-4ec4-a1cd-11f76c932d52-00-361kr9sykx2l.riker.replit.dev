import { describe, expect, it } from "vitest";
import { inquirySchema, inquiryLegacySyncSchema } from "@/validation/inquiryValidation";
import { parseInput } from "@/validation/parseValidation";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("inquiryValidation — test matrix", () => {
  it("requires followup_date for FollowUp status", () => {
    const result = parseInput(inquirySchema, {
      name: "Test Lead",
      phone: "9876543210",
      status: "FollowUp"
    });
    expectFail(result, ErrorCodes.validation);
  });

  it("accepts FollowUp with followup_date", () => {
    const result = parseInput(inquirySchema, {
      name: "Test Lead",
      phone: "9876543210",
      status: "FollowUp",
      followup_date: "2026-06-01"
    });
    expectOk(result);
    expect(result.data.status).toBe("FollowUp");
    expect(result.data.followup_date).toBe("2026-06-01");
  });

  it("normalises potential to uppercase in legacy sync", () => {
    const result = parseInput(inquiryLegacySyncSchema, {
      name: "Legacy",
      phone: "9876543210",
      potential: "warm"
    });
    expectOk(result);
    expect(result.data.potential).toBe("WARM");
  });

  it("allows legacy source labels without enum restriction", () => {
    const result = parseInput(inquiryLegacySyncSchema, {
      name: "Legacy",
      phone: "9876543210",
      source: "Just Dial"
    });
    expectOk(result);
    expect(result.data.source).toBe("Just Dial");
  });
});

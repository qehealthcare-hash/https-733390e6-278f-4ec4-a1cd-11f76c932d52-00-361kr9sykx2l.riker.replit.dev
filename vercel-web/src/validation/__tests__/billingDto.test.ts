import { describe, expect, it } from "vitest";
import { billingSummaryDtoSchema, parseBillingSummaryDto } from "@/validation/billingDto";
import { billingSummaryFixture } from "@/test/billingSummaryFixture";

describe("billingDto — contract schema", () => {
  it("parses a minimal billing summary bundle", () => {
    const sample = billingSummaryFixture();
    const parsed = parseBillingSummaryDto(sample);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.totals.billed).toBe(6050);
      expect(parsed.data.permissions.canReceive).toBe(true);
    }
    expect(billingSummaryDtoSchema.safeParse(sample).success).toBe(true);
  });
});

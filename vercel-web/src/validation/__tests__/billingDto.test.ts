import { describe, expect, it } from "vitest";
import {
  billingListResponseDtoSchema,
  billingSummaryDtoSchema,
  parseBillingListResponseDto,
  parseBillingSummaryDto,
  receiptRowDtoSchema
} from "@/validation/billingDto";
import { billingListResponseFixture } from "@/test/billingListFixture";
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

  it("parses billing list rows with negative net receipts (refund/reversal)", () => {
    const sample = billingListResponseFixture();
    const parsed = parseBillingListResponseDto(sample);
    if (!parsed.success) {
      console.error(parsed.error.flatten());
    }
    expect(parsed.success).toBe(true);
    expect(billingListResponseDtoSchema.safeParse(sample).success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rows[0]?.totals?.receipts).toBe(-5000);
    }
  });

  it("parses negative receipt rows inside a billing summary", () => {
    const sample = billingSummaryFixture({
      receipts: [
        {
          id: "RCP-20260613141733-cee927",
          billing_id: "B0529099390",
          invoice_id: "INV-20260613141733-ecf524",
          amount: "-5000"
        }
      ],
      totals: {
        services: 0,
        billed: 0,
        receipts: -5000,
        sec_dep: 0,
        discount: 0,
        advance: 0,
        outstanding: 0
      }
    });
    expect(parseBillingSummaryDto(sample).success).toBe(true);
    expect(
      receiptRowDtoSchema.safeParse({
        id: "RCP-20260613141733-cee927",
        billing_id: "B0529099390",
        amount: -5000
      }).success
    ).toBe(true);
  });
});

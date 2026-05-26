import { describe, expect, it } from "vitest";
import {
  payoutAdvanceSchema,
  payoutLockSchema,
  payoutPaySchema
} from "@/validation/payoutValidation";

describe("payoutValidation — proof required", () => {
  it("rejects pay without proof_bucket and proof_path", () => {
    const result = payoutPaySchema.safeParse({
      payout_id: "PAY1",
      amount: 1000
    });
    expect(result.success).toBe(false);
  });

  it("accepts pay when proof_bucket and proof_path are set", () => {
    const result = payoutPaySchema.safeParse({
      payout_id: "PAY1",
      amount: 1000,
      proof_bucket: "payout-proofs",
      proof_path: "2026-05/slip.jpg"
    });
    expect(result.success).toBe(true);
  });

  it("rejects advance without proof", () => {
    const result = payoutAdvanceSchema.safeParse({
      payout_id: "PAY1",
      amount: 500
    });
    expect(result.success).toBe(false);
  });
});

describe("payoutValidation — lock reason", () => {
  it("requires a non-empty lock reason", () => {
    const result = payoutLockSchema.safeParse({ reason: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid lock reason", () => {
    const result = payoutLockSchema.safeParse({
      reason: "Verified duty days and net amount"
    });
    expect(result.success).toBe(true);
  });
});

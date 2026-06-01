import { describe, expect, it } from "vitest";
import {
  assertCanGenerateFinalInvoice,
  assertCanRecordReceipt,
  assertInvoiceBelongsToBilling,
  canCancelInvoice,
  canDeleteInvoice,
  canIssueInvoice,
  canRegenerateInvoice,
  canSoftDeleteReceipt
} from "@/business/billingMutationRules";
import { computeBillingTotals } from "@/business/billingRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("billingMutationRules", () => {
  const partialTotals = computeBillingTotals({
    services: [{ total: 6050 }],
    receipts: [{ amount: 5000 }]
  });

  it("canIssueInvoice and canSoftDeleteReceipt block Closed bills", () => {
    expectFail(canIssueInvoice("Closed"), ErrorCodes.business);
    expectFail(canSoftDeleteReceipt("Closed"), ErrorCodes.business);
    expectOk(canIssueInvoice("Active"));
  });

  it("canCancelInvoice blocks Cancelled only", () => {
    expectFail(canCancelInvoice("Cancelled"), ErrorCodes.business);
    expectOk(canCancelInvoice("Closed"));
    expectOk(canCancelInvoice("Active"));
  });

  it("canDeleteInvoice blocks PAID rows", () => {
    expectFail(canDeleteInvoice("PAID"), ErrorCodes.business);
    expectOk(canDeleteInvoice("UNPAID"));
    expectOk(canDeleteInvoice("PARTIAL"));
  });

  it("assertInvoiceBelongsToBilling enforces billing_id match", () => {
    expectOk(assertInvoiceBelongsToBilling("B1", "B1"));
    expectFail(assertInvoiceBelongsToBilling("B2", "B1"), ErrorCodes.business);
  });

  it("canRegenerateInvoice requires MONTHLY with no receipts", () => {
    expectOk(
      canRegenerateInvoice({ kind: "MONTHLY", period: "2026-05", receivedOnInvoice: 0 })
    );
    expectFail(
      canRegenerateInvoice({ kind: "FINAL", period: null, receivedOnInvoice: 0 }),
      ErrorCodes.business
    );
    expectFail(
      canRegenerateInvoice({ kind: "MONTHLY", period: "2026-05", receivedOnInvoice: 100 }),
      ErrorCodes.business
    );
  });

  it("assertCanRecordReceipt delegates to canReceiveAgainst", () => {
    expectOk(
      assertCanRecordReceipt({
        billingStatus: "Closed",
        totals: partialTotals,
        amount: 1000
      })
    );
    expectFail(
      assertCanRecordReceipt({
        billingStatus: "Cancelled",
        totals: partialTotals,
        amount: 100
      }),
      ErrorCodes.business
    );
  });

  it("assertCanGenerateFinalInvoice matches FINAL button rules", () => {
    expectOk(
      assertCanGenerateFinalInvoice({
        billingStatus: "Closed",
        invoices: [{ id: "I1", kind: "MONTHLY", amount: 1000, status: "PAID" }],
        servicesTotal: 6050,
        secDep: 0
      })
    );
    expectFail(
      assertCanGenerateFinalInvoice({
        billingStatus: "Cancelled",
        invoices: [],
        servicesTotal: 0,
        secDep: 0
      }),
      ErrorCodes.business
    );
  });
});

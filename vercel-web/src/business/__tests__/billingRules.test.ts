import { describe, expect, it } from "vitest";
import {
  canCloseBilling,
  canEditBilling,
  canReopenBilling,
  canTransitionTo,
  sumReceiptAmounts,
  sumServiceTotals
} from "@/business/billingRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("billingRules — test matrix", () => {
  it("blocks edit on Closed bill", () => {
    expectFail(canEditBilling("Closed"), ErrorCodes.business);
    expectOk(canEditBilling("Active"));
  });

  it("close requires service entries", () => {
    const totals = {
      services: 100,
      receipts: 100,
      sec_dep: 0,
      discount: 0,
      advance: 0,
      outstanding: 0
    };
    expectFail(canCloseBilling(totals, 0, false), ErrorCodes.business);
    expectOk(canCloseBilling(totals, 1, false));
  });

  it("close blocks outstanding unless force", () => {
    const totals = {
      services: 100,
      receipts: 40,
      sec_dep: 0,
      discount: 0,
      advance: 0,
      outstanding: 60
    };
    expectFail(canCloseBilling(totals, 2, false), ErrorCodes.business);
    expectOk(canCloseBilling(totals, 2, true));
  });

  it("only Closed bills can reopen", () => {
    expectOk(canReopenBilling("Closed"));
    expectFail(canReopenBilling("Active"), ErrorCodes.business);
  });

  it("Cancelled bills are terminal", () => {
    expectFail(canTransitionTo("Cancelled", "Active"), ErrorCodes.business);
  });

  it("sums service totals and receipts for reports", () => {
    expect(sumServiceTotals([{ total: 100 }, { total: "50" }])).toBe(150);
    expect(sumReceiptAmounts([{ amount: 80 }, { amount: 20 }])).toBe(100);
  });
});

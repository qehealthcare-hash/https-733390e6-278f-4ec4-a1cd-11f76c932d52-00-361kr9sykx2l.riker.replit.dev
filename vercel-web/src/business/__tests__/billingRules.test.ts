import { describe, expect, it } from "vitest";
import {
  canCloseBilling,
  canEditBilling,
  canReopenBilling,
  canTransitionTo,
  computeBillingTotals,
  derivePaidStatus,
  billingPeriodsFromDates,
  invoiceOutstanding,
  sumReceiptAmounts,
  sumServiceTotals
} from "@/business/billingRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("billingRules — Paused transitions", () => {
  it("blocks Closed → Paused", () => {
    expectFail(canTransitionTo("Closed", "Paused"), ErrorCodes.business);
  });
  it("blocks Paused → Closed", () => {
    expectFail(canTransitionTo("Paused", "Closed"), ErrorCodes.business);
  });
  it("allows Active → Paused → Active → Closed", () => {
    expectOk(canTransitionTo("Active", "Paused"));
    expectOk(canTransitionTo("Paused", "Active"));
    expectOk(canTransitionTo("Active", "Closed"));
  });
  it("Cancelled remains terminal", () => {
    expectFail(canTransitionTo("Cancelled", "Active"), ErrorCodes.business);
  });
});

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

describe("billingRules — paid_status derivation", () => {
  it("brand-new bill with no services is UNPAID", () => {
    const totals = computeBillingTotals({ services: [], receipts: [] });
    expect(derivePaidStatus(totals)).toBe("UNPAID");
  });

  it("billed but no receipts is UNPAID", () => {
    const totals = computeBillingTotals({
      services: [{ total: 100, amount: 0 }],
      receipts: []
    });
    expect(derivePaidStatus(totals)).toBe("UNPAID");
  });

  it("billed with partial receipts is PARTIAL", () => {
    const totals = computeBillingTotals({
      services: [{ total: 100, amount: 0 }],
      receipts: [{ total: 0, amount: 40 }]
    });
    expect(derivePaidStatus(totals)).toBe("PARTIAL");
  });

  it("billed with receipts >= billed is PAID", () => {
    const totals = computeBillingTotals({
      services: [{ total: 100, amount: 0 }],
      receipts: [{ total: 0, amount: 100 }]
    });
    expect(derivePaidStatus(totals)).toBe("PAID");
  });
});

describe("billingRules — invoice period helpers", () => {
  it("billingPeriodsFromDates dedupes months", () => {
    expect(billingPeriodsFromDates(["2026-05-01", "2026-05-20"])).toEqual(["2026-05"]);
  });

  it("invoiceOutstanding never goes negative", () => {
    expect(invoiceOutstanding(100, 200)).toBe(0);
    expect(invoiceOutstanding(100, 40)).toBe(60);
  });
});

describe("billingRules — totals shape", () => {
  it("computeBillingTotals exposes `billed` alias for `services` (UI header)", () => {
    const totals = computeBillingTotals({
      services: [{ total: 6050 }, { total: 0 }],
      receipts: [{ amount: 5000 }]
    });
    expect(totals.services).toBe(6050);
    expect(totals.billed).toBe(6050);
    expect(totals.receipts).toBe(5000);
    expect(totals.outstanding).toBe(1050);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildBillingPermissions,
  canReceiveAgainst,
  canReceiveOnBilling
} from "@/business/billingRules";
import { computeBillingTotals } from "@/business/billingRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("billingRules — receipt gates", () => {
  const totalsWithOutstanding = computeBillingTotals({
    services: [{ total: 6050 }],
    receipts: [{ amount: 5000 }]
  });

  it("allows receipt on Closed bill with outstanding", () => {
    expectOk(canReceiveOnBilling("Closed", totalsWithOutstanding));
    expectOk(
      canReceiveAgainst({
        billingStatus: "Closed",
        totals: totalsWithOutstanding,
        amount: 1000
      })
    );
  });

  it("blocks Cancelled and fully settled bills", () => {
    const settled = computeBillingTotals({
      services: [{ total: 100 }],
      receipts: [{ amount: 100 }]
    });
    expectFail(canReceiveOnBilling("Cancelled", totalsWithOutstanding), ErrorCodes.business);
    expectFail(canReceiveOnBilling("Closed", settled), ErrorCodes.business);
    expectFail(
      canReceiveAgainst({
        billingStatus: "Cancelled",
        totals: totalsWithOutstanding,
        amount: 100
      }),
      ErrorCodes.business
    );
  });

  it("caps amount to bill and invoice outstanding", () => {
    expectFail(
      canReceiveAgainst({
        billingStatus: "Closed",
        totals: totalsWithOutstanding,
        amount: 2000
      }),
      ErrorCodes.business
    );
    expectFail(
      canReceiveAgainst({
        billingStatus: "Active",
        totals: totalsWithOutstanding,
        amount: 500,
        invoiceId: "INV1",
        invoiceOutstanding: 400
      }),
      ErrorCodes.business
    );
  });
});

describe("billingRules — buildBillingPermissions", () => {
  it("exposes canReceive on Closed bill with outstanding", () => {
    const totals = computeBillingTotals({
      services: [{ total: 6050 }],
      receipts: [{ amount: 5000 }]
    });
    const perms = buildBillingPermissions({
      billingStatus: "Closed",
      totals,
      serviceCount: 3,
      invoices: [{ id: "I1", kind: "MONTHLY", amount: 6050, status: "PARTIAL" }],
      servicesTotal: 6050,
      secDep: 5000
    });
    expect(perms.canReceive).toBe(true);
    expect(perms.canEdit).toBe(false);
    expect(perms.canReopen).toBe(true);
    expect(perms.canGenerateFinal).toBe(true);
    expect(perms.blockReasons?.canEdit).toBeTruthy();
  });
});

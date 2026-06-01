import { describe, expect, it } from "vitest";
import { buildPayoutPermissions } from "@/business/payoutRules";

describe("payoutRules — buildPayoutPermissions", () => {
  it("OPEN payout with duties can adjust, lock, and pay advance", () => {
    const perms = buildPayoutPermissions({
      status: "OPEN",
      outstanding: 10000,
      netAmount: 10000,
      dutyCount: 5
    });
    expect(perms.canAdjust).toBe(true);
    expect(perms.canLock).toBe(true);
    expect(perms.canReopen).toBe(false);
    expect(perms.canPayAdvance).toBe(true);
    expect(perms.canPayFinal).toBe(false);
  });

  it("LOCKED payout with outstanding can pay final but not advance", () => {
    const perms = buildPayoutPermissions({
      status: "LOCKED",
      outstanding: 6000,
      netAmount: 11000,
      dutyCount: 22
    });
    expect(perms.canAdjust).toBe(false);
    expect(perms.canLock).toBe(false);
    expect(perms.canReopen).toBe(true);
    expect(perms.canPayAdvance).toBe(false);
    expect(perms.canPayFinal).toBe(true);
  });

  it("PAID payout is terminal", () => {
    const perms = buildPayoutPermissions({
      status: "PAID",
      outstanding: 0,
      netAmount: 11000,
      dutyCount: 22
    });
    expect(perms.canAdjust).toBe(false);
    expect(perms.canPayFinal).toBe(false);
    expect(perms.canPayAdvance).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  canEditPayout,
  canLockPayout,
  canMarkPayoutPaid,
  canPayoutTransitionTo,
  canReopenPayout,
  payoutOutstanding,
  validatePayoutAmounts
} from "@/business/payoutRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("payoutRules — test matrix", () => {
  it("PAID payouts cannot be adjusted", () => {
    expectFail(canEditPayout("PAID"), ErrorCodes.business);
    expectOk(canEditPayout("OPEN"));
  });

  it("LOCKED payout requires reopen before adjust", () => {
    expectFail(canEditPayout("LOCKED"), ErrorCodes.business);
  });

  it("cannot mark paid twice", () => {
    expectFail(canMarkPayoutPaid("PAID"), ErrorCodes.business);
    expectOk(canMarkPayoutPaid("LOCKED"));
  });

  it("lock requires duties or net amount", () => {
    expectFail(canLockPayout("OPEN", 0, 0), ErrorCodes.business);
    expectOk(canLockPayout("OPEN", 500, 0));
    expectOk(canLockPayout("OPEN", 0, 3));
  });

  it("only LOCKED can reopen", () => {
    expectOk(canReopenPayout("LOCKED"));
    expectFail(canReopenPayout("OPEN"), ErrorCodes.business);
  });

  it("enforces OPEN → LOCKED → PAID transitions", () => {
    expectOk(canPayoutTransitionTo("OPEN", "LOCKED"));
    expectFail(canPayoutTransitionTo("PAID", "OPEN"), ErrorCodes.business);
  });

  it("validates advance + deduction against gross + bonus", () => {
    expectFail(validatePayoutAmounts(1000, 600, 500, 0), ErrorCodes.business);
    expectOk(validatePayoutAmounts(1000, 200, 100, 50));
  });

  it("computes payout outstanding", () => {
    expect(payoutOutstanding(1000, 400)).toBe(600);
    expect(payoutOutstanding(400, 500)).toBe(0);
  });
});

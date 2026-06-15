import { describe, expect, it } from "vitest";
import {
  breakdownByPatient,
  canEditPayout,
  canLockPayout,
  canMarkPayoutPaid,
  canPayAdvance,
  canPayoutTransitionTo,
  canReopenPayout,
  ensureWithinPayoutOutstanding,
  isPayoutFullyPaid,
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
    expectFail(canMarkPayoutPaid("OPEN"), ErrorCodes.business);
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
    expectFail(canPayoutTransitionTo("OPEN", "PAID"), ErrorCodes.business);
    expectOk(canPayoutTransitionTo("LOCKED", "PAID"));
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

  it("advance disbursement only allowed on OPEN payouts", () => {
    expectOk(canPayAdvance("OPEN"));
    expectFail(canPayAdvance("LOCKED"), ErrorCodes.business);
    expectFail(canPayAdvance("PAID"), ErrorCodes.business);
  });

  it("rejects disbursement that over-pays the outstanding net", () => {
    // 1000 net, 200 paid → remaining 800. 900 over-pays.
    expectFail(
      ensureWithinPayoutOutstanding(1000, 200, 900),
      ErrorCodes.business
    );
    expectOk(ensureWithinPayoutOutstanding(1000, 200, 800));
    // Tolerates a small rounding overshoot (≤ 0.5).
    expectOk(ensureWithinPayoutOutstanding(1000, 200, 800.4));
  });

  it("isPayoutFullyPaid clears within rounding tolerance", () => {
    expect(isPayoutFullyPaid(1000, 999.6)).toBe(true);
    expect(isPayoutFullyPaid(1000, 999.4)).toBe(false);
    expect(isPayoutFullyPaid(1000, 1200)).toBe(true);
  });

  it("breakdownByPatient is deprecated and returns empty (use charge ledger)", () => {
    const rows = breakdownByPatient(
      [
        {
          id: "D1",
          patient_id: "PID1",
          employee_id: "EMP1",
          start_at: "2026-05-01",
          shift_type: "24H",
          status: "IN_PROGRESS"
        }
      ],
      [{ duty_id: "D1", employee_id: "EMP1", hours: 8, status: "LATE", check_in_at: "2026-05-01" }]
    );
    expect(rows).toEqual([]);
  });
});

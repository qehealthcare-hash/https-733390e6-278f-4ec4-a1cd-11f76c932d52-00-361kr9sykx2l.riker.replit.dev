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

  it("breakdownByPatient splits hours, days, and ₹ across multiple patients", () => {
    const duties = [
      { id: "D1", patient_id: "PAT1", employee_id: "EMP1", status: "IN_PROGRESS", start_at: "2026-05-01T00:00:00Z", shift_type: "DAY" },
      { id: "D2", patient_id: "PAT2", employee_id: "EMP1", status: "IN_PROGRESS", start_at: "2026-05-10T00:00:00Z", shift_type: "DAY" },
      { id: "D3", patient_id: "PAT1", employee_id: "EMP1", status: "CANCELLED", start_at: "2026-05-20T00:00:00Z", shift_type: "DAY" }
    ];
    const attendance = [
      { duty_id: "D1", hours: 8, status: "PRESENT" },
      { duty_id: "D2", hours: 6, status: "PRESENT" },
      { duty_id: "D2", hours: 0, status: "ABSENT" } // ignored
    ];
    const charges = [
      { remarks: "duty:D1:2026-05-01:EMP1", amount: 800, date: "2026-05-01" },
      { remarks: "duty:D1:2026-05-02:EMP1", amount: 800, date: "2026-05-02" },
      { remarks: "duty:D2:2026-05-10:EMP1", amount: 600, date: "2026-05-10" }
    ];
    const rows = breakdownByPatient(duties, attendance, charges);

    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.patient_id, r]));
    expect(byId.PAT1.amount).toBe(1600);
    expect(byId.PAT1.duty_count).toBe(1);
    expect(byId.PAT1.hours).toBe(8);
    expect(byId.PAT1.dates).toEqual(["2026-05-01", "2026-05-02"]);
    expect(byId.PAT2.amount).toBe(600);
    expect(byId.PAT2.dates).toEqual(["2026-05-10"]);
    // Sorted by amount desc so the highest-paying patient renders first.
    expect(rows[0].patient_id).toBe("PAT1");
  });

  it("breakdownByPatient credits charges to the patient even if the source duty is CANCELLED (legacy/manual rows)", () => {
    const duties = [
      { id: "D1", patient_id: "PAT1", employee_id: "EMP1", status: "CANCELLED", start_at: "2026-05-01T00:00:00Z", shift_type: "DAY" }
    ];
    const attendance: Array<{
      duty_id: string;
      hours: number;
      status: string;
    }> = [];
    const charges = [
      { remarks: "duty:D1:2026-05-01:EMP1", amount: 500, date: "2026-05-01" }
    ];
    const rows = breakdownByPatient(duties, attendance, charges);
    expect(rows).toHaveLength(1);
    expect(rows[0].patient_id).toBe("PAT1");
    expect(rows[0].amount).toBe(500);
    // Duty count / hours stay at 0 because the duty was cancelled — only the
    // already-materialized charge is preserved.
    expect(rows[0].duty_count).toBe(0);
    expect(rows[0].hours).toBe(0);
  });
});

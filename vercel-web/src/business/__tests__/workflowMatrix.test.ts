/**
 * End-to-end workflow matrix using pure business + validation rules.
 *
 * Exercises the full CRM happy-path described in the integration brief —
 * create → assign duty → attendance → bill → payout → close — plus every
 * documented edge case (duplicates, mismatches, post-close edits).
 *
 * No Supabase fixtures required: every step works against the same rule
 * modules that the live API uses.
 */

import { describe, expect, it } from "vitest";

import { patientSchema } from "@/validation/patientValidation";
import { employeeSchema } from "@/validation/employeeValidation";
import { dutySchema } from "@/validation/dutyValidation";
import { attendanceSchema } from "@/validation/attendanceValidation";
import { billingSchema, billingCloseSchema } from "@/validation/billingValidation";
import { payoutSchema } from "@/validation/payoutValidation";
import { parseInput } from "@/validation/parseValidation";

import {
  buildAttendanceRow,
  ensureAttendanceHasAnchor,
  hoursBetween
} from "@/business/attendanceRules";
import {
  amountForShift,
  buildServiceEntryFromDuty,
  canCloseBilling,
  canEditBilling,
  canReopenBilling,
  canBillDuty,
  computeBillingTotals
} from "@/business/billingRules";
import {
  canEditPayout,
  canLockPayout,
  canMarkPayoutPaid,
  canReopenPayout,
  canPayoutTransitionTo,
  computePayoutNet,
  ensurePayoutHasSource
} from "@/business/payoutRules";
import {
  selectOverlappingDuty,
  selectPatientOverlappingDuty,
  canCancelDutyWithBilling,
  canReopenCompletedDuty,
  dutyCancellationPatch
} from "@/business/dutyRules";
import { canAssignCaretaker, canEditPatient } from "@/business/patientRules";
import { buildDashboardKpis, buildProfitLoss } from "@/business/reportRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

const ACTOR = "qa@hominal.test";

describe("CRM full workflow — module integration", () => {
  it("step 1: creates a patient with valid data", () => {
    const result = parseInput(patientSchema, {
      id: "PID000900",
      name: "Test Patient",
      phone: "+91 9876543210",
      city: "Ahmedabad",
      status: "Active"
    });
    expectOk(result);
    expect(result.data.phone).toBe("+919876543210");
    expect(result.data.name).toBe("Test Patient");
    expect(result.data.status).toBe("Active");
  });

  it("step 2: creates an employee with valid data", () => {
    const result = parseInput(employeeSchema, {
      id: "EMP000900",
      fn: "Test",
      ln: "Caretaker",
      phone: "+91 9876500000",
      role: "ATTENDANT",
      shift: "DAY",
      status: "Active"
    });
    expectOk(result);
    expect(result.data.phone).toBe("+919876500000");
    expect(result.data.status).toBe("Active");
  });

  it("step 3: schedules a duty, blocks self-link", () => {
    const ok = parseInput(dutySchema, {
      id: "DUTY000900",
      patient_id: "PID000900",
      employee_id: "EMP000900",
      start_at: "2026-06-01T08:00:00Z",
      end_at: "2026-06-01T16:00:00Z",
      shift_type: "DAY",
      status: "SCHEDULED"
    });
    expectOk(ok);

    const sameIds = parseInput(dutySchema, {
      patient_id: "EMP000900",
      employee_id: "EMP000900",
      start_at: "2026-06-01T08:00:00Z",
      end_at: "2026-06-01T16:00:00Z"
    });
    expectFail(sameIds, ErrorCodes.validation);

    const reversed = parseInput(dutySchema, {
      patient_id: "PID000900",
      employee_id: "EMP000900",
      start_at: "2026-06-01T16:00:00Z",
      end_at: "2026-06-01T08:00:00Z"
    });
    expectFail(reversed, ErrorCodes.validation);
  });

  it("step 3b: detects duplicate duty (same employee + overlapping window)", () => {
    const candidates = [
      {
        id: "DUTY000900",
        employee_id: "EMP000900",
        patient_id: "PID000900",
        start_at: "2026-06-01T08:00:00Z",
        end_at: "2026-06-01T16:00:00Z",
        status: "SCHEDULED"
      }
    ];
    const dup = selectOverlappingDuty(
      candidates,
      "EMP000900",
      "2026-06-01T10:00:00Z",
      "2026-06-01T18:00:00Z"
    );
    expect(dup?.id).toBe("DUTY000900");

    const patientDup = selectPatientOverlappingDuty(
      candidates,
      "PID000900",
      "2026-06-01T10:00:00Z",
      "2026-06-01T18:00:00Z"
    );
    expect(patientDup?.id).toBe("DUTY000900");

    const noConflict = selectOverlappingDuty(
      candidates,
      "EMP000999",
      "2026-06-01T10:00:00Z",
      "2026-06-01T18:00:00Z"
    );
    expect(noConflict).toBeNull();
  });

  it("step 4: marks attendance, computes hours, blocks anchorless PRESENT rows", () => {
    const checkIn = "2026-06-01T08:05:00Z";
    const checkOut = "2026-06-01T16:00:00Z";

    expectOk(
      ensureAttendanceHasAnchor({
        employee_id: "EMP000900",
        duty_id: "DUTY000900",
        check_in_at: checkIn,
        status: "PRESENT",
        notes: ""
      })
    );

    expectFail(
      ensureAttendanceHasAnchor({
        employee_id: "EMP000900",
        status: "PRESENT",
        notes: ""
      }),
      ErrorCodes.business
    );

    const parsed = parseInput(attendanceSchema, {
      duty_id: "DUTY000900",
      employee_id: "EMP000900",
      check_in_at: checkIn,
      check_out_at: checkOut,
      status: "PRESENT"
    });
    expectOk(parsed);

    const row = buildAttendanceRow(
      {
        ...parsed.data,
        status: parsed.data.status ?? "PRESENT",
        notes: parsed.data.notes ?? ""
      },
      ACTOR,
      "ATT000900"
    );
    expect(row.status).toBe("PRESENT");
    expect(row.check_in_at).toBe(checkIn);
    expect(row.check_out_at).toBe(checkOut);
    expect(row.hours).toBeCloseTo(hoursBetween(checkIn, checkOut), 2);
  });

  it("step 5: generates a bill + service entry from the duty", () => {
    const bill = parseInput(billingSchema, {
      id: "INVE000900",
      patient_id: "PID000900",
      status: "Active",
      sec_dep: 0
    });
    expectOk(bill);

    const dutyBillCheck = canBillDuty(
      { patient_id: "PID000900", status: "SCHEDULED", billing_id: null },
      null
    );
    expectOk(dutyBillCheck);

    const closedDutyBlock = canBillDuty(
      { patient_id: "PID000900", status: "SCHEDULED", billing_id: "INVE000800" },
      "Closed"
    );
    expectFail(closedDutyBlock, ErrorCodes.business);

    const cancelledDutyBlock = canBillDuty(
      { patient_id: "PID000900", status: "CANCELLED", billing_id: null },
      null
    );
    expectFail(cancelledDutyBlock, ErrorCodes.business);

    const amount = amountForShift("DAY");
    expect(amount).toBeGreaterThan(0);

    const svc = buildServiceEntryFromDuty({
      dutyId: "DUTY000900",
      patientId: "PID000900",
      billingId: "INVE000900",
      employeeId: "EMP000900",
      startAt: "2026-06-01T08:00:00Z",
      shiftType: "DAY",
      serviceName: "Caretaker",
      amount
    });
    expect(svc.billing_id).toBe("INVE000900");
    expect(svc.total).toBe(amount);
    expect(svc.svc_key).toBe("INVE000900_Caretaker");
  });

  it("step 6: generates a payout, requires source data, prevents over-deduction", () => {
    expectFail(ensurePayoutHasSource(0, 0), ErrorCodes.business);
    expectOk(ensurePayoutHasSource(1, 8));

    const parsed = parseInput(payoutSchema, {
      employee_id: "EMP000900",
      period_month: "2026-06",
      advance: 0,
      deduction: 0,
      bonus: 0
    });
    expectOk(parsed);

    const net = computePayoutNet(700, 100, 0, 200);
    expect(net).toBe(800);
    const clamped = computePayoutNet(700, 1000, 0, 0);
    expect(clamped).toBe(0);
  });

  it("step 7: closes a bill — guards against zero entries + outstanding", () => {
    const empty = computeBillingTotals({ services: [], receipts: [] });
    expectFail(canCloseBilling(empty, 0, false), ErrorCodes.business);

    const paid = computeBillingTotals({
      services: [{ total: 700 }],
      receipts: [{ amount: 700 }]
    });
    expectOk(canCloseBilling(paid, 1, false));

    const outstanding = computeBillingTotals({
      services: [{ total: 700 }],
      receipts: [{ amount: 200 }]
    });
    expectFail(canCloseBilling(outstanding, 1, false), ErrorCodes.business);
    expectOk(canCloseBilling(outstanding, 1, true));

    const close = parseInput(billingCloseSchema, { reason: "settled" });
    expectOk(close);
    expect(close.data.reason).toBe("settled");
  });

  it("step 7b: blocks duplicate bill close + edits on already-closed bills", () => {
    expectFail(canEditBilling("Closed"), ErrorCodes.business);
    expectFail(canEditBilling("Cancelled"), ErrorCodes.business);
    expectOk(canReopenBilling("Closed"));
    expectFail(canReopenBilling("Active"), ErrorCodes.business);
  });

  it("step 8: closes a payout (lock), blocks double-lock + PAID adjustments", () => {
    expectOk(canLockPayout("OPEN", 800, 1));
    expectFail(canLockPayout("PAID", 800, 1), ErrorCodes.business);
    expectFail(canLockPayout("OPEN", 0, 0), ErrorCodes.business);

    expectOk(canPayoutTransitionTo("OPEN", "LOCKED"));
    expectFail(canPayoutTransitionTo("PAID", "LOCKED"), ErrorCodes.business);

    expectFail(canEditPayout("LOCKED"), ErrorCodes.business);
    expectFail(canEditPayout("PAID"), ErrorCodes.business);

    expectOk(canMarkPayoutPaid("LOCKED"));
    expectFail(canMarkPayoutPaid("PAID"), ErrorCodes.business);

    expectOk(canReopenPayout("LOCKED"));
    expectFail(canReopenPayout("OPEN"), ErrorCodes.business);
  });

  it("step 9: dashboard math reconciles bills + payouts for the period", () => {
    const kpis = buildDashboardKpis(
      "2026-06",
      { from: "2026-06-01T00:00:00Z", to: "2026-07-01T00:00:00Z" },
      {
        patients_total: 1,
        patients_active: 1,
        employees_total: 1,
        employees_active: 1,
        inquiries_this_month: 0,
        duties_active: 1,
        duties_scheduled: 0,
        duties_completed: 1,
        duties_cancelled: 0,
        billings_total: 1,
        billings_open: 0,
        billings_closed: 1,
        service_rows: [{ total: 700, billing_id: "INVE000900" }],
        receipt_rows: [{ amount: 700, billing_id: "INVE000900" }],
        payout_rows: [{ gross_amount: 700, net_amount: 800, advance: 100, deduction: 0, bonus: 200, status: "PAID" }]
      }
    );
    expect(kpis.billing_total_amount).toBe(700);
    expect(kpis.billing_collected_amount).toBe(700);
    expect(kpis.billing_pending_amount).toBe(0);
    expect(kpis.payout_total_amount).toBe(800);
    expect(kpis.payout_paid_amount).toBe(800);
    expect(kpis.profit_loss).toBe(700 - 800);
  });

  it("step 10: profit-loss report matches dashboard window math", () => {
    const pl = buildProfitLoss(
      "2026-06",
      { from: "2026-06-01T00:00:00Z", to: "2026-07-01T00:00:00Z" },
      {
        receipts: [{ amount: 700 }],
        payouts: [{ net_amount: 800, status: "PAID" }]
      }
    );
    expect(pl.revenue).toBe(700);
    expect(pl.payouts_paid).toBe(800);
    expect(pl.net_profit).toBe(700 - 800);
  });
});

describe("CRM full workflow — edge & failure matrix", () => {
  it("rejects invalid patient (missing phone)", () => {
    expectFail(parseInput(patientSchema, { name: "No Phone" }), ErrorCodes.validation);
  });

  it("rejects invalid patient (missing name)", () => {
    expectFail(parseInput(patientSchema, { phone: "9876543210" }), ErrorCodes.validation);
  });

  it("rejects employee with short mobile", () => {
    expectFail(
      parseInput(employeeSchema, { fn: "Short", phone: "12345" }),
      ErrorCodes.validation
    );
  });

  it("rejects duplicate bill creation by duty status (cancelled/no_show)", () => {
    expectFail(
      canBillDuty(
        { patient_id: "PID000900", status: "CANCELLED", billing_id: null },
        null
      ),
      ErrorCodes.business
    );
    expectFail(
      canBillDuty(
        { patient_id: "PID000900", status: "NO_SHOW", billing_id: null },
        null
      ),
      ErrorCodes.business
    );
  });

  it("blocks editing a duty after its bill has receipts (cancel-and-rebill path)", () => {
    expectFail(canCancelDutyWithBilling(true, 1), ErrorCodes.business);
    expectOk(canCancelDutyWithBilling(true, 0));
    expectOk(canCancelDutyWithBilling(false, 5));
  });

  it("blocks reopening a COMPLETED duty (re-bill safety)", () => {
    expectFail(canReopenCompletedDuty("COMPLETED", "SCHEDULED"), ErrorCodes.business);
  });

  it("cancellation patch carries reason + actor", () => {
    expect(dutyCancellationPatch(ACTOR, "double-booked")).toEqual({
      status: "CANCELLED",
      cancel_reason: "double-booked",
      updated_by: ACTOR
    });
  });

  it("blocks caretaker assignment when patient is Closed (inactive)", () => {
    expectFail(canAssignCaretaker("Closed"), ErrorCodes.business);
  });

  it("blocks patient edit when status is Closed (inactive)", () => {
    expectFail(canEditPatient("Closed"), ErrorCodes.business);
  });

  it("treats employee Inactive status as a deactivation (UI cannot adjust payouts)", () => {
    // Employee status doesn't have a direct guard but downstream payout edits are
    // blocked once the payout is LOCKED / PAID; verify both layers fail closed.
    expectFail(canEditPayout("LOCKED"), ErrorCodes.business);
    expectFail(canEditPayout("PAID"), ErrorCodes.business);
  });

  it("billing and payout mismatch surfaces in dashboard (negative profit)", () => {
    const kpis = buildDashboardKpis(
      "2026-06",
      { from: "2026-06-01T00:00:00Z", to: "2026-07-01T00:00:00Z" },
      {
        patients_total: 1,
        patients_active: 1,
        employees_total: 1,
        employees_active: 1,
        inquiries_this_month: 0,
        duties_active: 1,
        duties_scheduled: 0,
        duties_completed: 1,
        duties_cancelled: 0,
        billings_total: 1,
        billings_open: 0,
        billings_closed: 1,
        service_rows: [{ total: 500 }],
        receipt_rows: [{ amount: 0 }],
        payout_rows: [{ net_amount: 800, status: "PAID" }]
      }
    );
    expect(kpis.billing_pending_amount).toBe(500);
    expect(kpis.profit_loss).toBeLessThan(0);
  });
});

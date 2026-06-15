import { describe, expect, it } from "vitest";
import {
  buildDutyPermissions,
  canCancelDuty,
  canCancelDutyWithBilling,
  canEditDutyStatus,
  canReopenCompletedDuty,
  computeDutyFreeze,
  dutiesTimeOverlap,
  dutyPersistRow,
  effectiveMaterializeEndAt,
  isOpenEndedEndAt,
  isOverlapExcludedStatus,
  OPEN_ENDED_END_AT,
  openEndedSentinelFor,
  payoutPeriodForDuty,
  selectOverlappingDuty,
  selectPatientOverlappingDuty,
  selectSamePatientEmployeeOverlap,
  shouldCheckDutyOverlap
} from "@/business/dutyRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

describe("dutyRules — form status guard", () => {
  it("allows no-op (status unchanged)", () => {
    expectOk(canEditDutyStatus("SCHEDULED", "SCHEDULED"));
    expectOk(canEditDutyStatus("IN_PROGRESS", "IN_PROGRESS"));
  });
  it("allows SCHEDULED → CANCELLED from the form", () => {
    expectOk(canEditDutyStatus("SCHEDULED", "CANCELLED"));
  });
  it("allows NO_SHOW → SCHEDULED (admin re-schedule)", () => {
    expectOk(canEditDutyStatus("NO_SHOW", "SCHEDULED"));
  });
  it("blocks SCHEDULED → COMPLETED (must check in/out via dedicated endpoints)", () => {
    expectFail(canEditDutyStatus("SCHEDULED", "COMPLETED"), ErrorCodes.business);
  });
  it("blocks SCHEDULED → IN_PROGRESS via the form", () => {
    expectFail(canEditDutyStatus("SCHEDULED", "IN_PROGRESS"), ErrorCodes.business);
  });
  it("blocks IN_PROGRESS → COMPLETED via the form", () => {
    expectFail(canEditDutyStatus("IN_PROGRESS", "COMPLETED"), ErrorCodes.business);
  });
});

const slot = (id: string, employee: string, patient: string, start: string, end: string, status = "SCHEDULED") => ({
  id,
  employee_id: employee,
  patient_id: patient,
  start_at: start,
  end_at: end,
  status
});

describe("dutyRules — workflow matrix", () => {
  it("detects overlapping windows", () => {
    expect(
      dutiesTimeOverlap(
        "2026-06-01T08:00:00Z",
        "2026-06-01T16:00:00Z",
        "2026-06-01T12:00:00Z",
        "2026-06-01T20:00:00Z"
      )
    ).toBe(true);
    expect(
      dutiesTimeOverlap(
        "2026-06-01T08:00:00Z",
        "2026-06-01T12:00:00Z",
        "2026-06-01T12:00:00Z",
        "2026-06-01T20:00:00Z"
      )
    ).toBe(false);
  });

  it("flags duplicate duty for same employee", () => {
    const list = [
      slot("D1", "EMP1", "PAT1", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z"),
      slot("D2", "EMP2", "PAT2", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z")
    ];
    const hit = selectOverlappingDuty(list, "EMP1", "2026-06-01T10:00:00Z", "2026-06-01T18:00:00Z");
    expect(hit?.id).toBe("D1");
  });

  it("flags duplicate duty for same patient (double-booked caretakers)", () => {
    const list = [
      slot("D1", "EMP1", "PAT1", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z")
    ];
    const hit = selectPatientOverlappingDuty(list, "PAT1", "2026-06-01T12:00:00Z", "2026-06-01T20:00:00Z");
    expect(hit?.id).toBe("D1");
  });

  it("hard-flags same (patient, employee) overlap — never a relief case", () => {
    const list = [
      slot("D1", "EMP1", "PAT1", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z"),
      // Same patient, DIFFERENT employee (legit relief / partner share)
      slot("D2", "EMP2", "PAT1", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z")
    ];
    const hit = selectSamePatientEmployeeOverlap(
      list,
      "PAT1",
      "EMP1",
      "2026-06-01T12:00:00Z",
      "2026-06-01T20:00:00Z"
    );
    expect(hit?.id).toBe("D1");
  });

  it("does NOT flag a relief carer (same patient, different employee)", () => {
    const list = [slot("D2", "EMP2", "PAT1", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z")];
    expect(
      selectSamePatientEmployeeOverlap(
        list,
        "PAT1",
        "EMP1",
        "2026-06-01T12:00:00Z",
        "2026-06-01T20:00:00Z"
      )
    ).toBeNull();
  });

  it("catches two open-ended duties for the same pair (the silent doubling bug)", () => {
    // Both run to the far-future sentinel; starts are 12 days apart.
    const list = [
      slot("D1", "EMP1", "PAT1", "2026-05-15T03:30:00Z", OPEN_ENDED_END_AT)
    ];
    const hit = selectSamePatientEmployeeOverlap(
      list,
      "PAT1",
      "EMP1",
      "2026-05-27T03:30:00Z",
      OPEN_ENDED_END_AT,
      "D2"
    );
    expect(hit?.id).toBe("D1");
  });

  it("excludes self when re-saving the same pair (edit-in-place)", () => {
    const list = [slot("D1", "EMP1", "PAT1", "2026-05-15T03:30:00Z", OPEN_ENDED_END_AT)];
    expect(
      selectSamePatientEmployeeOverlap(
        list,
        "PAT1",
        "EMP1",
        "2026-05-15T03:30:00Z",
        OPEN_ENDED_END_AT,
        "D1"
      )
    ).toBeNull();
  });

  it("skips CANCELLED and NO_SHOW duties when checking overlap", () => {
    const cancelled = slot("D1", "EMP1", "PAT1", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z", "CANCELLED");
    expect(isOverlapExcludedStatus("CANCELLED")).toBe(true);
    expect(isOverlapExcludedStatus("NO_SHOW")).toBe(true);
    expect(shouldCheckDutyOverlap("CANCELLED")).toBe(false);
    expect(
      selectOverlappingDuty([cancelled], "EMP1", "2026-06-01T10:00:00Z", "2026-06-01T18:00:00Z")
    ).toBeNull();
  });

  it("excludes self when re-saving a duty (edit-in-place not a duplicate)", () => {
    const list = [
      slot("D1", "EMP1", "PAT1", "2026-06-01T08:00:00Z", "2026-06-01T16:00:00Z")
    ];
    expect(
      selectOverlappingDuty(list, "EMP1", "2026-06-01T09:00:00Z", "2026-06-01T17:00:00Z", "D1")
    ).toBeNull();
  });

  it("blocks reopening a COMPLETED duty", () => {
    expectFail(canReopenCompletedDuty("COMPLETED", "SCHEDULED"), ErrorCodes.business);
    expectOk(canReopenCompletedDuty("COMPLETED", "COMPLETED"));
    expectOk(canReopenCompletedDuty("SCHEDULED", "COMPLETED"));
  });

  it("refuses to cancel a duty whose bill already has receipts", () => {
    expectFail(canCancelDutyWithBilling(true, 1), ErrorCodes.business);
    expectOk(canCancelDutyWithBilling(true, 0));
    expectOk(canCancelDutyWithBilling(false, 5));
  });

  it("blocks cancelling a COMPLETED duty", () => {
    expectFail(canCancelDuty("COMPLETED"), ErrorCodes.business);
    expectOk(canCancelDuty("IN_PROGRESS"));
    expectFail(canCancelDuty("CANCELLED"), ErrorCodes.business);
  });
});

describe("dutyRules — open-ended duty (no end_at)", () => {
  it("isOpenEndedEndAt detects sentinel and blank end_at", () => {
    expect(isOpenEndedEndAt(undefined)).toBe(true);
    expect(isOpenEndedEndAt("")).toBe(true);
    expect(isOpenEndedEndAt(OPEN_ENDED_END_AT)).toBe(true);
    expect(isOpenEndedEndAt("2099-12-31T00:00:00Z")).toBe(true);
    expect(isOpenEndedEndAt("2026-05-01T08:00:00Z")).toBe(false);
  });

  it("dutyPersistRow defaults end_at to the open-ended sentinel when missing", () => {
    const row = dutyPersistRow({
      id: "DUTY1",
      patient_id: "PAT1",
      employee_id: "EMP1",
      shift_type: "DAY",
      start_at: "2026-05-01T08:00:00Z",
      status: "SCHEDULED",
      service_name: "Care Taker Services"
    });
    expect(row.end_at).toBe(openEndedSentinelFor("2026-05-01T08:00:00Z"));
    expect(isOpenEndedEndAt(row.end_at)).toBe(true);
  });

  it("dutyPersistRow keeps an explicit end_at when provided", () => {
    const row = dutyPersistRow({
      id: "DUTY1",
      patient_id: "PAT1",
      employee_id: "EMP1",
      shift_type: "DAY",
      start_at: "2026-05-01T08:00:00Z",
      end_at: "2026-05-10T20:00:00Z",
      status: "SCHEDULED",
      service_name: "Care Taker Services"
    });
    expect(row.end_at).toBe("2026-05-10T20:00:00Z");
  });

  it("effectiveMaterializeEndAt for an open-ended duty caps to today", () => {
    const today = "2026-05-04T23:59:59.999Z";
    const result = effectiveMaterializeEndAt({ end_at: OPEN_ENDED_END_AT }, null, today);
    expect(result).toBe(today);
  });

  it("effectiveMaterializeEndAt caps to bill close date when earlier than today", () => {
    const today = "2026-05-04T23:59:59.999Z";
    const billClose = "2026-05-02T18:00:00Z";
    const result = effectiveMaterializeEndAt({ end_at: OPEN_ENDED_END_AT }, billClose, today);
    expect(result).toBe(billClose);
  });

  it("effectiveMaterializeEndAt respects explicit end_at when earlier than today", () => {
    const today = "2026-05-10T23:59:59.999Z";
    const result = effectiveMaterializeEndAt({ end_at: "2026-05-05T20:00:00Z" }, null, today);
    expect(result).toBe("2026-05-05T20:00:00Z");
  });

  it("effectiveMaterializeEndAt compares timestamps not strings (mixed Z / +05:30)", () => {
    // today = IST end-of-day on May 29 (= 18:29 UTC).
    // duty.end_at = May 29 20:00 UTC (= 01:30 IST May 30) — actually
    // AFTER today. Lexically `T20...Z` < `T23:59...+05:30`, so the
    // string-comparison version mistakenly picks duty.end_at and
    // materializes 1.5h past today, seeding phantom diary rows for
    // May 30 that billing then has to dedup.
    const today = "2026-05-29T23:59:59.999+05:30";
    const result = effectiveMaterializeEndAt(
      { end_at: "2026-05-29T20:00:00Z" },
      null,
      today
    );
    expect(result).toBe(today);
  });

  it("effectiveMaterializeEndAt picks the bill close when truly earlier (timestamp-safe)", () => {
    // billClosedAt is in `Z`, today is in `+05:30`; the timestamps
    // resolve to today > billClosedAt and the function must pick
    // billClosedAt despite the lexical `+05:30` > `Z` ordering.
    const today = "2026-05-29T23:59:59.999+05:30";
    const billClosedAt = "2026-05-25T18:30:00Z";
    const result = effectiveMaterializeEndAt(
      { end_at: OPEN_ENDED_END_AT },
      billClosedAt,
      today
    );
    expect(result).toBe(billClosedAt);
  });
});

describe("dutyRules — duty editability freeze (billing done / payout made)", () => {
  it("stays editable while billing is not done and payout is remaining", () => {
    const f = computeDutyFreeze({ billHasReceipt: false, totalSlots: 5, paidSlots: 0 });
    expect(f.frozen).toBe(false);
    expect(f.partiallyFrozen).toBe(false);
    const perms = buildDutyPermissions({ status: "SCHEDULED", totalSlots: 5, paidSlots: 0 });
    expect(perms.canEdit).toBe(true);
    expect(perms.canCancel).toBe(true);
    expect(perms.frozen).toBe(false);
  });

  it("freezes the duty once the bill has a receipt (billing done)", () => {
    const f = computeDutyFreeze({ billHasReceipt: true, totalSlots: 5, paidSlots: 0 });
    expect(f.frozen).toBe(true);
    const perms = buildDutyPermissions({
      status: "SCHEDULED",
      billHasReceipt: true,
      hasBillingServiceLine: true,
      totalSlots: 5,
      paidSlots: 0
    });
    expect(perms.canEdit).toBe(false);
    expect(perms.canCancel).toBe(false);
    expect(perms.blockReasons?.canEdit).toMatch(/receipt/i);
  });

  it("freezes the duty once every day is paid (payout made)", () => {
    const f = computeDutyFreeze({ billHasReceipt: false, totalSlots: 3, paidSlots: 3 });
    expect(f.frozen).toBe(true);
    const perms = buildDutyPermissions({ status: "SCHEDULED", totalSlots: 3, paidSlots: 3 });
    expect(perms.canEdit).toBe(false);
    expect(perms.blockReasons?.canEdit).toMatch(/paid/i);
  });

  it("keeps a partially-paid duty editable but un-cancellable (per-day)", () => {
    const f = computeDutyFreeze({ billHasReceipt: false, totalSlots: 5, paidSlots: 2 });
    expect(f.frozen).toBe(false);
    expect(f.partiallyFrozen).toBe(true);
    const perms = buildDutyPermissions({ status: "SCHEDULED", totalSlots: 5, paidSlots: 2 });
    expect(perms.canEdit).toBe(true);
    expect(perms.canCancel).toBe(false);
    expect(perms.partiallyFrozen).toBe(true);
  });
});

describe("dutyRules — payoutPeriodForDuty (IST)", () => {
  it("returns YYYY-MM in IST for a same-month UTC start", () => {
    expect(payoutPeriodForDuty("2026-05-15T10:00:00Z", "")).toBe("2026-05");
  });

  it("rolls a 18:30 UTC Apr 30 start into the IST May payout period", () => {
    // 18:30 UTC Apr 30 = 00:00 IST May 1. Diary materialize bills May,
    // so payout recompute must also target May.
    expect(payoutPeriodForDuty("2026-04-30T18:30:00Z", "")).toBe("2026-05");
  });

  it("falls back to the fallback timestamp when start_at is empty", () => {
    expect(payoutPeriodForDuty("", "2026-05-31T22:00:00Z")).toBe("2026-06");
  });

  it("returns empty string when both inputs are empty", () => {
    expect(payoutPeriodForDuty("", "")).toBe("");
  });
});

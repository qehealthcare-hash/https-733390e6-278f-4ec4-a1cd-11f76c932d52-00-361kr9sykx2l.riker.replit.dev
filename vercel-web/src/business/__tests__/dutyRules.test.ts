import { describe, expect, it } from "vitest";
import {
  canCancelDuty,
  canCancelDutyWithBilling,
  canEditDutyStatus,
  canReopenCompletedDuty,
  dutiesTimeOverlap,
  dutyPersistRow,
  effectiveMaterializeEndAt,
  isOpenEndedEndAt,
  isOverlapExcludedStatus,
  OPEN_ENDED_END_AT,
  openEndedSentinelFor,
  selectOverlappingDuty,
  selectPatientOverlappingDuty,
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
});

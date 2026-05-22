import { describe, expect, it } from "vitest";
import {
  canCancelDutyWithBilling,
  canReopenCompletedDuty,
  dutiesTimeOverlap,
  isOverlapExcludedStatus,
  selectOverlappingDuty,
  selectPatientOverlappingDuty,
  shouldCheckDutyOverlap
} from "@/business/dutyRules";
import { ErrorCodes } from "@/types/common";
import { expectFail, expectOk } from "@/test/assertions";

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
});

import { describe, expect, it } from "vitest";
import { billingSvcKey } from "@/business/billingRules";
import {
  eachDutyCalendarDay,
  collectDutyPartners,
  dutyDiaryRemarks,
  buildSvcEntryRow,
  parseDutyDiaryRemarks,
  expectedDiarySlotKeys,
  diarySlotKey,
  findDutyLedgerRows,
  filterManualLedgerRows,
  normalizeExcludedDays,
  addExcludedDaySlot,
  excludedDaySet,
  isDayExcluded
} from "@/business/dutyDiaryRules";

describe("dutyDiaryRules", () => {
  it("uses legacy billing svc_key", () => {
    expect(billingSvcKey("INVE001", "Care Taker Services")).toBe("INVE001_Care Taker Services");
  });

  it("expands inclusive calendar days in IST", () => {
    // 10:00 UTC = 15:30 IST → IST day = May 1; 08:00 UTC = 13:30 IST → May 3.
    const days = eachDutyCalendarDay("2026-05-01T10:00:00Z", "2026-05-03T08:00:00Z");
    expect(days).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
  });

  it("treats start_at after IST midnight on its UTC-prior day as the IST day", () => {
    // 18:30 UTC on Apr 30 = 00:00 IST on May 1.
    // Duty calendar (IST) should NOT include Apr 30.
    const days = eachDutyCalendarDay("2026-04-30T18:30:00Z", "2026-05-02T18:30:00Z");
    expect(days).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
  });

  it("single-day duty bills exactly that one IST day", () => {
    // Both timestamps in the same IST day → bills only that day.
    const days = eachDutyCalendarDay("2026-05-11T03:30:00Z", "2026-05-11T13:30:00Z");
    expect(days).toEqual(["2026-05-11"]);
  });

  it("dedupes partners by employee_id", () => {
    const partners = collectDutyPartners(
      "EMP1",
      500,
      300,
      "Daily",
      [{ employee_id: "EMP1" }, { employee_id: "EMP2", payout_per_day: 400 }]
    );
    expect(partners).toHaveLength(2);
    expect(partners[1].employee_id).toBe("EMP2");
    expect(partners[1].payout_per_day).toBe(400);
  });

  it("builds duty-linked remarks", () => {
    expect(dutyDiaryRemarks("D1", "2026-05-01", "EMP9")).toBe("duty:D1:2026-05-01:EMP9");
    const row = buildSvcEntryRow({
      dutyId: "D1",
      billingId: "B1",
      serviceName: "Care Taker Services",
      patientId: "P1",
      employeeId: "EMP1",
      employeeName: "Alice",
      isoDate: "2026-05-01",
      shiftType: "DAY",
      chargePerDay: 600,
      payoutPerDay: 400,
      payoutTerm: "Daily"
    });
    expect(row.svc_key).toBe("B1_Care Taker Services");
    expect(row.remarks).toBe("duty:D1:2026-05-01:EMP1");
    expect(row.duty_id).toBe("D1");
    expect(row.total).toBe(600);
  });

  it("parses duty diary remarks", () => {
    expect(parseDutyDiaryRemarks("duty:D1:2026-05-01:EMP9")).toEqual({
      dutyId: "D1",
      isoDate: "2026-05-01",
      employeeId: "EMP9",
      manual: false
    });
    expect(parseDutyDiaryRemarks("duty:D1:2026-05-01:EMP9:m")).toEqual({
      dutyId: "D1",
      isoDate: "2026-05-01",
      employeeId: "EMP9",
      manual: true
    });
    expect(parseDutyDiaryRemarks("legacy")).toBeNull();
  });

  it("flags duty-calendar rows that Billing/Payout must not replace", () => {
    const rows = [
      { remarks: "duty:D1:2026-05-01:EMP1" },
      { remarks: "" },
      { remarks: "manual adjustment" },
      { remarks: "duty:D2:2026-05-02:EMP2:m" },
      { remarks: null }
    ];
    const flagged = findDutyLedgerRows(rows);
    expect(flagged).toHaveLength(2);
    expect(flagged.map((r) => r.remarks)).toEqual([
      "duty:D1:2026-05-01:EMP1",
      "duty:D2:2026-05-02:EMP2:m"
    ]);
  });

  it("returns no duty rows for empty / non-duty input", () => {
    expect(findDutyLedgerRows([])).toEqual([]);
    expect(findDutyLedgerRows(null)).toEqual([]);
    expect(findDutyLedgerRows([{ remarks: "legacy" }, { remarks: "" }])).toEqual([]);
  });

  it("filterManualLedgerRows excludes duty-calendar remarks", () => {
    const rows = [
      { remarks: "duty:D1:2026-05-01:EMP1", amt: 1 },
      { remarks: "manual", amt: 2 },
      { remarks: "", amt: 3 }
    ];
    expect(filterManualLedgerRows(rows)).toEqual([
      { remarks: "manual", amt: 2 },
      { remarks: "", amt: 3 }
    ]);
  });

  it("builds expected slot keys for window (IST)", () => {
    // 10:00 UTC May 1 = 15:30 IST May 1; 10:00 UTC May 2 = 15:30 IST May 2.
    const keys = expectedDiarySlotKeys(
      "2026-05-01T10:00:00Z",
      "2026-05-02T10:00:00Z",
      [{ employee_id: "EMP1" }, { employee_id: "EMP2" }]
    );
    expect(keys.has(diarySlotKey("2026-05-01", "EMP1"))).toBe(true);
    expect(keys.has(diarySlotKey("2026-05-02", "EMP2"))).toBe(true);
    expect(keys.size).toBe(4);
  });

  it("omits operator-excluded slots from expected keys", () => {
    const excluded = excludedDaySet(normalizeExcludedDays([{ date: "2026-05-01", employee_id: "EMP1" }]));
    const keys = expectedDiarySlotKeys(
      "2026-05-01T10:00:00Z",
      "2026-05-02T10:00:00Z",
      [{ employee_id: "EMP1" }],
      { excluded }
    );
    expect(keys.has(diarySlotKey("2026-05-01", "EMP1"))).toBe(false);
    expect(keys.has(diarySlotKey("2026-05-02", "EMP1"))).toBe(true);
    expect(isDayExcluded(excluded, "2026-05-01", "EMP1")).toBe(true);
  });

  it("dedupes excluded day slots on normalize/add", () => {
    const slots = addExcludedDaySlot(
      normalizeExcludedDays([{ date: "2026-05-26", employee_id: "EMP9" }]),
      "2026-05-26",
      "EMP9"
    );
    expect(slots).toEqual([{ date: "2026-05-26", employee_id: "EMP9" }]);
  });
});

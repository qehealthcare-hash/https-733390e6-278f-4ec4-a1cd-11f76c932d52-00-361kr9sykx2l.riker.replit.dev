import { describe, expect, it } from "vitest";
import { billingSvcKey } from "@/business/billingRules";
import {
  eachDutyCalendarDay,
  collectDutyPartners,
  dutyDiaryRemarks,
  buildSvcEntryRow
} from "@/business/dutyDiaryRules";

describe("dutyDiaryRules", () => {
  it("uses legacy billing svc_key", () => {
    expect(billingSvcKey("INVE001", "Care Taker Services")).toBe("INVE001_Care Taker Services");
  });

  it("expands inclusive calendar days", () => {
    const days = eachDutyCalendarDay("2026-05-01T10:00:00Z", "2026-05-03T08:00:00Z");
    expect(days).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
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
    expect(row.total).toBe(600);
  });
});

import { describe, expect, it } from "vitest";
import {
  attendanceDateKey,
  attendanceDutyEmployeeKey,
  attendancePayoutPeriod,
  attendanceRowWorkDate,
  buildAttendanceRow,
  findAttendanceDuplicate,
  hoursBetween
} from "@/business/attendanceRules";

describe("attendanceRules", () => {
  it("hoursBetween rounds to 2dp", () => {
    expect(hoursBetween("2026-05-01T09:00:00+05:30", "2026-05-01T17:00:00+05:30")).toBe(8);
  });

  it("attendanceDateKey prefers work_date", () => {
    expect(attendanceDateKey("2026-05-01T00:00:00.000Z", "2026-05-02")).toBe("2026-05-02");
  });

  it("attendancePayoutPeriod uses work_date month", () => {
    expect(attendancePayoutPeriod(null, null, "2026-05-15")).toBe("2026-05");
  });

  it("findAttendanceDuplicate matches duty + employee", () => {
    const dup = findAttendanceDuplicate(
      [
        {
          id: "A1",
          employee_id: "E1",
          duty_id: "D1",
          status: "PRESENT",
          notes: ""
        },
        {
          id: "A2",
          employee_id: "E2",
          duty_id: "D1",
          status: "PRESENT",
          notes: ""
        }
      ],
      "E2",
      "D1",
      "2026-05-01"
    );
    expect(dup?.id).toBe("A2");
  });

  it("buildAttendanceRow persists shift_type and work_date", () => {
    const row = buildAttendanceRow(
      {
        employee_id: "E1",
        status: "ABSENT",
        notes: "",
        shift_type: "24H",
        work_date: "2026-05-25"
      },
      "admin@test.com",
      "ATT1"
    );
    expect(row.shift_type).toBe("24H");
    expect(row.work_date).toBe("2026-05-25");
    expect(row.check_in_at).toBeNull();
  });

  it("attendanceDutyEmployeeKey composes stable key", () => {
    expect(attendanceDutyEmployeeKey("D1", "E1")).toBe("D1|E1");
  });

  it("attendanceRowWorkDate reads work_date column", () => {
    expect(attendanceRowWorkDate({ work_date: "2026-05-24" })).toBe("2026-05-24");
  });
});

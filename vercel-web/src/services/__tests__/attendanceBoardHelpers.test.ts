import { describe, expect, it } from "vitest";
import {
  indexAttendanceForBoard,
  matchAttendanceForSlot
} from "@/services/attendanceBoardHelpers";

describe("attendanceBoardHelpers", () => {
  it("indexes by duty+employee and matches slot", () => {
    const maps = indexAttendanceForBoard([
      {
        id: "A1",
        duty_id: "D1",
        employee_id: "E1",
        work_date: "2026-05-24",
        status: "PRESENT"
      },
      {
        id: "A2",
        duty_id: "D1",
        employee_id: "E2",
        work_date: "2026-05-24",
        status: "LATE"
      }
    ]);
    expect(matchAttendanceForSlot("D1", "E2", "2026-05-24", maps)?.id).toBe("A2");
    expect(matchAttendanceForSlot("D1", "E1", "2026-05-25", maps)).toBeUndefined();
  });
});

import type { JsonRow } from "@/database/types";
import {
  attendanceDutyEmployeeKey,
  attendanceRowWorkDate
} from "@/business/attendanceRules";

export function indexAttendanceForBoard(rows: JsonRow[]): {
  attByDutyEmployee: Map<string, JsonRow>;
  attByEmpDate: Map<string, JsonRow>;
} {
  const attByDutyEmployee = new Map<string, JsonRow>();
  const attByEmpDate = new Map<string, JsonRow>();
  const seen = new Set<string>();
  for (const row of rows) {
    const aid = String(row.id || "");
    if (!aid || seen.has(aid)) continue;
    seen.add(aid);
    const dutyId = String(row.duty_id || "");
    const emp = String(row.employee_id || "");
    const date = attendanceRowWorkDate(row);
    if (dutyId && emp) {
      attByDutyEmployee.set(attendanceDutyEmployeeKey(dutyId, emp), row);
    }
    if (emp && date) {
      const key = `${emp}|${date}`;
      attByEmpDate.set(key, row);
    }
  }
  return { attByDutyEmployee, attByEmpDate };
}

export function matchAttendanceForSlot(
  dutyId: string,
  employeeId: string,
  date: string,
  maps: ReturnType<typeof indexAttendanceForBoard>
): JsonRow | undefined {
  const byDuty = maps.attByDutyEmployee.get(attendanceDutyEmployeeKey(dutyId, employeeId));
  if (byDuty && attendanceRowWorkDate(byDuty) === date) return byDuty;
  const byDate = maps.attByEmpDate.get(`${employeeId}|${date}`);
  if (byDate && String(byDate.duty_id || "") === dutyId) return byDate;
  if (byDate && !byDate.duty_id) return byDate;
  return undefined;
}

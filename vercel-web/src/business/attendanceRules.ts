import { payoutPeriodFromTimestamp } from "@/business/dateRules";

export function hoursBetween(checkIn?: string | null, checkOut?: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return diff > 0 ? Math.round((diff / 3_600_000) * 100) / 100 : 0;
}

/** Hours for duty check-out (unrounded, then rounded to 2dp in storage). */
export function computeCheckOutHours(checkInAt: string, checkOutAt: string): number {
  return Math.max(0, (new Date(checkOutAt).getTime() - new Date(checkInAt).getTime()) / 3_600_000);
}

export function attendanceUpdateFields(
  checkIn: string,
  checkOut: string | null | undefined,
  status: string,
  notes: string
) {
  return {
    check_in_at: checkIn,
    check_out_at: checkOut || null,
    hours: hoursBetween(checkIn, checkOut || undefined),
    status,
    notes
  };
}

export { payoutPeriodFromTimestamp };

export interface AttendanceRollupRow {
  employee_id?: string | null;
  status?: string | null;
  hours?: number | string | null;
}

export interface AttendanceRollup {
  present: number;
  absent: number;
  late: number;
  hours: number;
}

const EMPTY_ROLLUP: AttendanceRollup = { present: 0, absent: 0, late: 0, hours: 0 };

export function aggregateAttendanceByEmployee(rows: AttendanceRollupRow[]): Map<string, AttendanceRollup> {
  const map = new Map<string, AttendanceRollup>();
  for (const a of rows) {
    if (!a.employee_id) continue;
    const m = map.get(a.employee_id) || { ...EMPTY_ROLLUP };
    if (a.status === "PRESENT") m.present += 1;
    else if (a.status === "ABSENT") m.absent += 1;
    else if (a.status === "LATE") m.late += 1;
    m.hours += Number(a.hours || 0);
    map.set(a.employee_id, m);
  }
  return map;
}

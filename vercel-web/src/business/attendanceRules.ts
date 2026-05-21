import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import { payoutPeriodFromTimestamp } from "@/business/dateRules";
import type { AttendanceStatus } from "@/validation/attendanceValidation";
import { ATTENDANCE_NO_TIME_STATUSES } from "@/validation/attendanceValidation";

export type { AttendanceStatus };
export { ATTENDANCE_NO_TIME_STATUSES };

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

/** Input shape consumed by attendanceService.persist (after Zod parse). */
export interface AttendancePersistInput {
  id?: string;
  duty_id?: string;
  employee_id: string;
  patient_id?: string;
  shift_type?: string;
  check_in_at?: string;
  check_out_at?: string;
  status: AttendanceStatus;
  notes: string;
}

export interface AttendanceRow {
  id: string;
  duty_id?: string | null;
  employee_id: string;
  patient_id?: string | null;
  shift_type?: string | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  hours?: number | null;
  status: string;
  notes?: string | null;
}

/**
 * Build the `hh_attendance` row to persist on insert/upsert.
 * Status-based time clamping happens here so we never store
 * `check_in_at` for an `ABSENT` record.
 */
export function buildAttendanceRow(
  input: AttendancePersistInput,
  actorEmail: string,
  fallbackId: string
) {
  const noTime = ATTENDANCE_NO_TIME_STATUSES.has(input.status);
  const checkIn = noTime ? null : input.check_in_at || new Date().toISOString();
  const checkOut = noTime ? null : input.check_out_at || null;
  return {
    id: input.id || fallbackId,
    duty_id: input.duty_id || null,
    employee_id: input.employee_id,
    patient_id: input.patient_id || null,
    shift_type: input.shift_type || null,
    check_in_at: checkIn,
    check_out_at: checkOut,
    hours: hoursBetween(checkIn, checkOut),
    status: input.status,
    notes: input.notes ?? "",
    created_by: actorEmail,
    updated_by: actorEmail
  };
}

/** Patch shape applied on attendanceService.update. */
export function buildAttendancePatch(
  existing: AttendanceRow,
  input: AttendancePersistInput,
  actorEmail: string
) {
  const noTime = ATTENDANCE_NO_TIME_STATUSES.has(input.status);
  const checkIn = noTime ? null : input.check_in_at || existing.check_in_at || null;
  const checkOut = noTime ? null : input.check_out_at || existing.check_out_at || null;
  return {
    duty_id: input.duty_id ?? existing.duty_id ?? null,
    patient_id: input.patient_id ?? existing.patient_id ?? null,
    shift_type: input.shift_type ?? existing.shift_type ?? null,
    check_in_at: checkIn,
    check_out_at: checkOut,
    hours: hoursBetween(checkIn, checkOut),
    status: input.status,
    notes: input.notes ?? existing.notes ?? "",
    updated_by: actorEmail
  };
}

/**
 * Two attendance rows are duplicates when they share employee + duty (when a
 * duty is provided) OR share employee + calendar date (when no duty is set).
 *
 * Pre-fetched candidates allow the repository to scope the query however it
 * likes (by duty_id, or by date-window) and the rule layer to make the call.
 */
export function findAttendanceDuplicate(
  candidates: AttendanceRow[],
  employeeId: string,
  dutyId: string | undefined,
  dateKey: string,
  excludeId?: string
): AttendanceRow | null {
  return (
    candidates.find((c) => {
      if (c.id === excludeId) return false;
      if (c.employee_id !== employeeId) return false;
      if (dutyId) return c.duty_id === dutyId;
      const candidateDate = String(c.check_in_at || "").slice(0, 10);
      return candidateDate === dateKey;
    }) || null
  );
}

/** Calendar date key (YYYY-MM-DD) used for duplicate detection. */
export function attendanceDateKey(checkInAt: string | undefined | null): string {
  return String(checkInAt || new Date().toISOString()).slice(0, 10);
}

/**
 * Returns the YYYY-MM period for which payout must be recomputed when an
 * attendance row is created or modified. Falls back to a duty timestamp,
 * then to the attendance timestamp, then to "today" so cancelled/no-show
 * rows still rebalance the staff's payslip.
 */
export function attendancePayoutPeriod(
  attendanceCheckIn: string | undefined | null,
  dutyStart: string | undefined | null,
  fallbackNow = new Date().toISOString()
): string {
  return (
    payoutPeriodFromTimestamp(dutyStart || undefined) ||
    payoutPeriodFromTimestamp(attendanceCheckIn || undefined) ||
    payoutPeriodFromTimestamp(fallbackNow)
  );
}

/**
 * Edits to PRESENT-style attendance require either a check-in or a duty
 * reference so payout can attribute the hours.
 */
export function ensureAttendanceHasAnchor(input: AttendancePersistInput): ApiResult<null> {
  if (ATTENDANCE_NO_TIME_STATUSES.has(input.status)) return businessOk();
  if (input.check_in_at || input.duty_id) return businessOk();
  return businessFailure("PRESENT/LATE/HALF_DAY attendance needs check_in_at or duty_id");
}

export interface MissingAttendanceDuty {
  id: string;
  employee_id?: string | null;
  patient_id?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  status?: string | null;
}

/**
 * For a list of duties + a map of attended duty IDs, return the duties that
 * have no attendance row. Used by the dashboard "missing attendance" view.
 */
export function selectMissingAttendance(
  duties: MissingAttendanceDuty[],
  attendedDutyIds: Set<string>
): MissingAttendanceDuty[] {
  return duties.filter((d) => {
    if (!d.id) return false;
    if (attendedDutyIds.has(d.id)) return false;
    const status = String(d.status || "").toUpperCase();
    if (status === "CANCELLED" || status === "NO_SHOW" || status === "SCHEDULED") return true;
    return !attendedDutyIds.has(d.id);
  });
}

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

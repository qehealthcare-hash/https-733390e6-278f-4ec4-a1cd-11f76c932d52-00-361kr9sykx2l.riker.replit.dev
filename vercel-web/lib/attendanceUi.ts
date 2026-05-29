/**
 * Attendance module UI helpers (M8 Pass D).
 *
 * Pure date/presentation utilities — no API calls.
 */

import { crmDateKeyFromTimestamp, crmTodayIso } from "@/src/utils/crmToday";

export const DERIVED_STATUS_STYLES: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  PRESENT: { bg: "#dcfce7", border: "#16a34a", text: "#14532d" },
  IN_PROGRESS: { bg: "#dbeafe", border: "#2563eb", text: "#1e3a8a" },
  COMPLETED: { bg: "#e0e7ff", border: "#4f46e5", text: "#312e81" },
  LATE: { bg: "#fef3c7", border: "#d97706", text: "#92400e" },
  HALF_DAY: { bg: "#fef9c3", border: "#ca8a04", text: "#854d0e" },
  ABSENT: { bg: "#fee2e2", border: "#dc2626", text: "#7f1d1d" },
  LEAVE: { bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95" },
  HOLIDAY: { bg: "#cffafe", border: "#0e7490", text: "#155e75" },
  SCHEDULED: { bg: "#f1f5f9", border: "#64748b", text: "#1f2937" },
  UNMARKED: { bg: "#f8fafc", border: "#cbd5e1", text: "#475569" }
};

export const ATTENDANCE_STATUS_OPTIONS = [
  { value: "PRESENT", label: "Present" },
  { value: "ABSENT", label: "Absent" },
  { value: "LATE", label: "Late" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "LEAVE", label: "Leave" },
  { value: "HOLIDAY", label: "Holiday" }
] as const;

export const ATTENDANCE_SHIFT_OPTIONS = [
  { value: "DAY", label: "Day (9-7)" },
  { value: "NIGHT", label: "Night (8-8)" },
  { value: "24H", label: "24 hours" },
  { value: "FULL", label: "Full" }
] as const;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

/** IST calendar date (YYYY-MM-DD) for a stored ISO timestamp. */
export function istDayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return crmDateKeyFromTimestamp(iso);
}

export function todayDate(): string {
  return crmTodayIso();
}

/** Start of the current IST week (Sunday). */
export function startOfWeek(): string {
  const todayKey = crmTodayIso();
  const anchor = new Date(todayKey + "T12:00:00+05:30");
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short"
  }).format(anchor);
  const dow = WEEKDAY_INDEX[weekdayName] ?? 0;
  anchor.setDate(anchor.getDate() - dow);
  return crmDateKeyFromTimestamp(anchor.toISOString());
}

/** Build an IST-offset ISO timestamp from a calendar date + HH:mm. */
export function isoDateTime(date: string, time?: string): string {
  if (!date) return "";
  if (!time) return date + "T09:00:00.000+05:30";
  return date + "T" + time + ":00.000+05:30";
}

export interface AttendanceMarkForm {
  duty_id: string;
  employee_id: string;
  patient_id: string;
  shift_type: string;
  work_date: string;
  check_in_time: string;
  check_out_time: string;
  status: string;
  notes: string;
}

export function emptyMarkForm(): AttendanceMarkForm {
  return {
    duty_id: "",
    employee_id: "",
    patient_id: "",
    shift_type: "DAY",
    work_date: todayDate(),
    check_in_time: "09:00",
    check_out_time: "",
    status: "PRESENT",
    notes: ""
  };
}

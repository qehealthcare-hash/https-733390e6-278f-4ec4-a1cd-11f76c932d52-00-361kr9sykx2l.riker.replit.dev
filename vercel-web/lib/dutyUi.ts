/**
 * Duty module UI helpers (M7 Pass D).
 *
 * Pure calendar/date utilities shared by the duties page — no API calls.
 */

import { crmDateKeyFromTimestamp } from "@/src/utils/crmToday";
import type { DutyPermissionsDto } from "@/validation/dutyDto";

export const DUTY_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

export function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function monthKey(d: Date): string {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}

/** IST calendar date (YYYY-MM-DD) for a stored ISO timestamp. */
export function istDayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return crmDateKeyFromTimestamp(iso);
}

export function isOpenEndedIso(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return String(iso).slice(0, 10) === "2099-12-31";
}

export interface DutyCalendarRow {
  start_at?: string;
  end_at?: string;
}

export interface DutyExtraPartner {
  employee_id: string;
  charge_per_day?: number | string | null;
  payout_per_day?: number | string | null;
  payout_term?: string;
  partner?: string;
}

/** Row shape from duty list/detail APIs (includes legacy aliases). */
export interface DutyListRow extends DutyCalendarRow {
  id: string;
  patient_id?: string;
  employee_id?: string;
  service_name?: string;
  service_type?: string;
  shift_type?: string;
  status?: string;
  charge_per_day?: number | string | null;
  payout_per_day?: number | string | null;
  payout_term?: string;
  extra_partners?: DutyExtraPartner[];
  notes?: string;
  updated_at?: string | null;
  permissions?: DutyPermissionsDto;
  patient_name?: string;
  employee_name?: string;
  partner?: string;
}

export interface DutyDiaryEntry {
  date: string;
  employee_id: string;
  partner?: string;
  charge?: number | string | null;
  payout?: number | string | null;
  svc_updated_at?: string | null;
  payout_updated_at?: string | null;
  manual?: boolean;
}

/**
 * Whether a duty row overlaps an IST calendar day.
 *
 * Open-ended duties (no `end_at` or sentinel `2099-12-31`) extend from `start`
 * through TODAY (IST) — i.e. an active patient's care band keeps appearing on
 * the calendar every day from its start through today, but NOT into the
 * future. This must mirror `materializeDuty`'s `effectiveMaterializeEndAt`
 * (which clips at today) or the duty calendar would paint cells that billing
 * will never have svc_entries for — the exact "31 calendar days vs 27 billed
 * days" mismatch this rule prevents. Fixed ranges use `end_at` as-is.
 */
export function dutyTouchesDay(row: DutyCalendarRow, isoDay: string): boolean {
  if (!row.start_at || !isoDay) return false;
  const start = istDayKey(row.start_at);
  const rawEnd = istDayKey(row.end_at || row.start_at);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date()
  );
  const end = isOpenEndedIso(row.end_at) ? today : rawEnd;
  return isoDay >= start && isoDay <= end;
}

export function daysInMonthGrid(year: number, monthIndex: number): Array<string | null> {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<string | null> = [];
  let i: number;
  for (i = 0; i < startPad; i++) cells.push(null);
  for (i = 1; i <= days; i++) {
    cells.push(year + "-" + pad2(monthIndex + 1) + "-" + pad2(i));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function partnerDisplayName(
  employeeId: string,
  storedPartner: string | undefined,
  employeeNameById: Record<string, string>
): string {
  const lookup = employeeNameById[employeeId];
  if (lookup && lookup !== employeeId) return lookup;
  if (storedPartner && storedPartner !== employeeId) return storedPartner;
  return lookup || storedPartner || employeeId || "—";
}

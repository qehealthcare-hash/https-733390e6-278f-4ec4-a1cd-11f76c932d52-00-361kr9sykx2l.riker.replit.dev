/**
 * HTML date input min/max helpers — mirror server validation in the UI (P2-8).
 */
import { crmTodayIso } from "@/src/utils/crmToday";

/** Leaving date must be on or after joining date when both are set. */
export function employeeLeaveDateMin(joinDate: string | undefined | null): string | undefined {
  const j = String(joinDate || "").trim();
  return j || undefined;
}

/** Follow-up cannot be scheduled in the past. */
export function inquiryFollowupDateMin(): string {
  return crmTodayIso();
}

/** Receipts and ad-hoc service lines cannot be dated in the future. */
export function ledgerBackdatedDateMax(): string {
  return crmTodayIso();
}

/** Patient care start date cannot be in the future. */
export function patientStartDateMax(): string {
  return crmTodayIso();
}

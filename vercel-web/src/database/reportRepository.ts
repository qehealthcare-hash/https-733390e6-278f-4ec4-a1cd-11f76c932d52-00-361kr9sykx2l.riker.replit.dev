import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow } from "@/database/types";
import {
  countWhere,
  monthRange,
  listAll,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const SCOPE = "reportRepository";

export interface ReportFilters {
  patient_id?: string;
  employee_id?: string;
  status?: string;
  from?: string; // ISO
  to?: string; // ISO
}

/** Raw count/aggregate rows for dashboard — no derived KPI math here. */
export const reportRepository = {
  monthRange,

  // ───────────────────────────────────────────────────────────────────
  // Patients
  // ───────────────────────────────────────────────────────────────────

  countActivePatients(opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_patients", SCOPE, (q) => q.eq("status", "Active"), opts);
  },

  countAllPatients(opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_patients", SCOPE, (q) => q, opts);
  },

  // ───────────────────────────────────────────────────────────────────
  // Employees
  // ───────────────────────────────────────────────────────────────────

  countAllEmployees(opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_employees", SCOPE, (q) => q, opts);
  },

  countActiveEmployees(opts?: DbAccess): Promise<ApiResult<number>> {
    // `hh_employees` has no `status` column — employee activity is encoded as
    // `leave_date` (empty / null = still on staff, non-empty = left on that
    // date). Mirror that in the count.
    return countWhere(
      "hh_employees",
      SCOPE,
      (q) => q.or("leave_date.is.null,leave_date.eq."),
      opts
    );
  },

  // ───────────────────────────────────────────────────────────────────
  // Inquiries
  // ───────────────────────────────────────────────────────────────────

  countInquiriesInRange(
    startISO: string,
    endISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return countWhere(
      "hh_inquiries",
      SCOPE,
      (q) => q.gte("created_at", startISO).lt("created_at", endISO),
      opts
    );
  },

  // ───────────────────────────────────────────────────────────────────
  // Duties
  // ───────────────────────────────────────────────────────────────────

  /** Count duties whose `start_at` is inside [from, to). */
  countDutiesInRange(
    startISO: string,
    endISO: string,
    extra: { status?: string[]; employeeId?: string; patientId?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return countWhere(
      "hh_duties",
      SCOPE,
      (q) => {
        let query = q.gte("start_at", startISO).lt("start_at", endISO);
        if (extra.status && extra.status.length > 0) {
          query = query.in("status", extra.status);
        }
        if (extra.employeeId) query = query.eq("employee_id", extra.employeeId);
        if (extra.patientId) query = query.eq("patient_id", extra.patientId);
        return query;
      },
      opts
    );
  },

  /** Backwards-compatible aliases used by the legacy report.service.ts. */
  countDutiesScheduledInRange(
    startISO: string,
    endISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return this.countDutiesInRange(
      startISO,
      endISO,
      { status: ["SCHEDULED", "IN_PROGRESS"] },
      opts
    );
  },

  countDutiesCompletedInRange(
    startISO: string,
    endISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return this.countDutiesInRange(startISO, endISO, { status: ["COMPLETED"] }, opts);
  },

  // ───────────────────────────────────────────────────────────────────
  // Billings
  // ───────────────────────────────────────────────────────────────────

  countBillings(
    filters: { status?: string; patientId?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return countWhere(
      "hh_billings",
      SCOPE,
      (q) => {
        let query = q;
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.patientId) query = query.eq("patient_id", filters.patientId);
        return query;
      },
      opts
    );
  },

  countOpenBillings(opts?: DbAccess): Promise<ApiResult<number>> {
    return this.countBillings({ status: "Active" }, opts);
  },

  /** List billing rows in window with optional patient filter — used for groupBy. */
  listBillingsInRange(
    filters: ReportFilters & { status?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_billings")
          .select("id, patient_id, status, sec_dep, created_at");
        if (filters.from) q = q.gte("created_at", filters.from);
        if (filters.to) q = q.lt("created_at", filters.to);
        if (filters.patient_id) q = q.eq("patient_id", filters.patient_id);
        if (filters.status) q = q.eq("status", filters.status);
        return q;
      },
      `${SCOPE}.listBillingsInRange`
    );
  },

  // ───────────────────────────────────────────────────────────────────
  // Service entries + Receipts (the canonical source of "billed" / "collected")
  // ───────────────────────────────────────────────────────────────────

  /**
   * Service entries within a date window — used for "billing total".
   * `hh_svc_entries.date` is a plain text yyyy-mm-dd, so the caller must
   * pass YYYY-MM-DD-style boundaries (not ISO timestamps).
   */
  listServicesInRange(
    fromDate: string,
    toDate: string,
    filters: { patient_id?: string; billing_id?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_svc_entries")
          .select("id, billing_id, total, amt, count, date, remarks")
          .gte("date", fromDate)
          .lt("date", toDate);
        if (filters.billing_id) q = q.eq("billing_id", filters.billing_id);
        return q;
      },
      `${SCOPE}.listServicesInRange`
    );
  },

  /**
   * Active (non-soft-deleted) receipts within an ISO `created_at` window.
   * Used for "collected revenue" and "profit/loss".
   */
  listReceiptsInRange(
    fromISO: string,
    toISO: string,
    filters: { patient_id?: string; billing_id?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_receipts")
          .select("id, billing_id, amount, method, date, created_at, deleted_at")
          .is("deleted_at", null)
          .gte("created_at", fromISO)
          .lt("created_at", toISO);
        if (filters.billing_id) q = q.eq("billing_id", filters.billing_id);
        return q;
      },
      `${SCOPE}.listReceiptsInRange`
    );
  },

  /** Legacy alias kept for backwards-compat with old report.service.ts. */
  listReceiptAmountsInRange(
    startISO: string,
    endISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    return this.listReceiptsInRange(startISO, endISO, {}, opts);
  },

  // ───────────────────────────────────────────────────────────────────
  // Payouts
  // ───────────────────────────────────────────────────────────────────

  listPayoutsForPeriod(
    period: string,
    filters: { employee_id?: string; status?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_payouts")
          .select(
            "id, employee_id, period_month, gross_amount, advance, deduction, bonus, net_amount, status, duty_count, hours, paid_at"
          )
          .eq("period_month", period);
        if (filters.employee_id) q = q.eq("employee_id", filters.employee_id);
        if (filters.status) q = q.eq("status", filters.status);
        return q;
      },
      `${SCOPE}.listPayoutsForPeriod`
    );
  },

  /** Backwards-compat: PAID-only slice. */
  listPaidPayoutsForPeriod(period: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return this.listPayoutsForPeriod(period, { status: "PAID" }, opts);
  },

  listPayrollRows(
    period: string,
    filters: { employee_id?: string; status?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    // Same as listPayoutsForPeriod but ordered by net amount for display.
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_payouts")
          .select(
            "id, employee_id, period_month, gross_amount, advance, deduction, bonus, net_amount, status, duty_count, hours"
          )
          .eq("period_month", period)
          .order("net_amount", { ascending: false });
        if (filters.employee_id) q = q.eq("employee_id", filters.employee_id);
        if (filters.status) q = q.eq("status", filters.status);
        return q;
      },
      `${SCOPE}.listPayrollRows`
    );
  },

  // ───────────────────────────────────────────────────────────────────
  // Attendance
  // ───────────────────────────────────────────────────────────────────

  listAttendanceInRange(
    startISO: string,
    endISO: string,
    filters: { employee_id?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_attendance")
          .select("employee_id, status, hours, check_in_at")
          .gte("check_in_at", startISO)
          .lt("check_in_at", endISO);
        if (filters.employee_id) q = q.eq("employee_id", filters.employee_id);
        return q;
      },
      `${SCOPE}.listAttendanceInRange`
    );
  }
};

/** Helper exported for callers using yyyy-mm-dd boundaries. */
export function ymdRangeFromISO(isoFrom: string, isoTo: string): { from: string; to: string } {
  return { from: isoFrom.slice(0, 10), to: isoTo.slice(0, 10) };
}

/** Listing helper preserved for legacy callers. */
export { listAll };

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

/** Hard ceiling on any defensive list-row materialisation in this repo. */
export const REPORT_ROW_CEILING = 1000;

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
  listBillingsByIds(ids: string[], opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!unique.length) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => db.from("hh_billings").select("id, patient_id, status, sec_dep, created_at").in("id", unique),
      `${SCOPE}.listBillingsByIds`
    );
  },

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
  async listServicesInRange(
    fromDate: string,
    toDate: string,
    filters: { patient_id?: string; billing_id?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    let billingIds: string[] | null = null;
    if (filters.patient_id) {
      const billings = await this.listBillingsByPatient(filters.patient_id, opts);
      if (!billings.success) return billings;
      billingIds = (billings.data || []).map((b) => String(b.id || "")).filter(Boolean);
      if (!billingIds.length) return { success: true, data: [] };
    }
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_svc_entries")
          .select("id, billing_id, total, amt, count, date, remarks")
          .gte("date", fromDate)
          .lt("date", toDate);
        if (filters.billing_id) q = q.eq("billing_id", filters.billing_id);
        else if (billingIds) q = q.in("billing_id", billingIds);
        return q;
      },
      `${SCOPE}.listServicesInRange`
    );
  },

  /** Partner payout charge ledger rows (legacy diary + duty calendar materialized). */
  listPayoutChargesInRange(
    fromDate: string,
    toDate: string,
    filters: { partner_id?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_payout_charges")
          .select("id, svc_key, date, partner, partner_id, amount, remarks")
          .gte("date", fromDate)
          .lt("date", toDate);
        if (filters.partner_id) q = q.eq("partner_id", filters.partner_id);
        return q;
      },
      `${SCOPE}.listPayoutChargesInRange`
    );
  },

  /**
   * Active (non-soft-deleted) receipts for a period window.
   * Uses business `date` (YYYY-MM-DD) when set; otherwise `created_at`.
   */
  async listReceiptsInRange(
    fromISO: string,
    toISO: string,
    filters: { patient_id?: string; billing_id?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const fromYMD = fromISO.slice(0, 10);
    const toYMD = toISO.slice(0, 10);
    const db = resolveClient(opts);
    let billingIds: string[] | null = null;
    if (filters.patient_id) {
      const billings = await this.listBillingsByPatient(filters.patient_id, opts);
      if (!billings.success) return billings;
      billingIds = (billings.data || []).map((b) => String(b.id || "")).filter(Boolean);
      if (!billingIds.length) return { success: true, data: [] };
    }

    const byBusinessDate = await runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_receipts")
          .select("id, billing_id, amount, method, date, created_at, deleted_at")
          .is("deleted_at", null)
          .gte("date", fromYMD)
          .lt("date", toYMD);
        if (filters.billing_id) q = q.eq("billing_id", filters.billing_id);
        else if (billingIds) q = q.in("billing_id", billingIds);
        return q;
      },
      `${SCOPE}.listReceiptsInRange.byDate`
    );
    if (!byBusinessDate.success) return byBusinessDate;

    const undated = await runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_receipts")
          .select("id, billing_id, amount, method, date, created_at, deleted_at")
          .is("deleted_at", null)
          .or("date.is.null,date.eq.")
          .gte("created_at", fromISO)
          .lt("created_at", toISO);
        if (filters.billing_id) q = q.eq("billing_id", filters.billing_id);
        else if (billingIds) q = q.in("billing_id", billingIds);
        return q;
      },
      `${SCOPE}.listReceiptsInRange.undated`
    );
    if (!undated.success) return undated;

    const seen = new Set<string>();
    const merged: JsonRow[] = [];
    for (const row of [...(byBusinessDate.data || []), ...(undated.data || [])]) {
      const id = String(row.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
    return { success: true, data: merged };
  },

  listBillingsByPatient(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => db.from("hh_billings").select("id").eq("patient_id", patientId),
      `${SCOPE}.listBillingsByPatient`
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

  // ───────────────────────────────────────────────────────────────────
  // Per-tab summary helpers (Phase 12 — server-side aggregation)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Count inquiries in the supplied [from, to) window with optional filters.
   * Uses Supabase `count='exact', head: true` so a head-only query returns
   * the total row count without materialising rows.
   */
  countInquiriesScoped(
    fromISO: string,
    toISO: string,
    filters: { status?: string; source?: string; assigned_to?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return countWhere(
      "hh_inquiries",
      `${SCOPE}.countInquiriesScoped`,
      (q) => {
        let query = q.gte("created_at", fromISO).lt("created_at", toISO);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.source) query = query.eq("source", filters.source);
        if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);
        return query;
      },
      opts
    );
  },

  /**
   * Slim list slice for the inquiry detail tab. Capped at `REPORT_ROW_CEILING`
   * so even with `?limit=99999` the API can't be tricked into pulling every
   * row — the aggregates above remain accurate via `count='exact'`.
   */
  async listInquiriesScoped(
    fromISO: string,
    toISO: string,
    filters: { status?: string; source?: string; assigned_to?: string } = {},
    paging: { limit?: number; offset?: number } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const limit = Math.max(1, Math.min(paging.limit ?? 50, REPORT_ROW_CEILING));
    const offset = Math.max(0, paging.offset ?? 0);
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_inquiries")
          .select(
            "id, name, phone, area, city, status, potential, source, assigned_to, followup_date, created_at"
          )
          .gte("created_at", fromISO)
          .lt("created_at", toISO)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (filters.status) q = q.eq("status", filters.status);
        if (filters.source) q = q.eq("source", filters.source);
        if (filters.assigned_to) q = q.eq("assigned_to", filters.assigned_to);
        return q;
      },
      `${SCOPE}.listInquiriesScoped`
    );
  },

  /**
   * Defensive group-by slice — used to roll up free-form text fields like
   * `source` / `potential` where the enum isn't known in advance. Capped at
   * `REPORT_ROW_CEILING`; the page falls back to "Other" if more rows exist.
   */
  async listInquiriesForGroupBy(
    fromISO: string,
    toISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from("hh_inquiries")
          .select("id, status, potential, source, followup_date, created_at")
          .gte("created_at", fromISO)
          .lt("created_at", toISO)
          .range(0, REPORT_ROW_CEILING - 1),
      `${SCOPE}.listInquiriesForGroupBy`
    );
  },

  /** Count inquiries with a follow-up date inside the [from, to) window. */
  countInquiriesFollowupDue(
    fromYMD: string,
    toYMD: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return countWhere(
      "hh_inquiries",
      `${SCOPE}.countInquiriesFollowupDue`,
      (q) => q.gte("followup_date", fromYMD).lte("followup_date", toYMD),
      opts
    );
  },

  /** Patients created inside [from, to) — used by the patients detail tab. */
  countPatientsScoped(
    fromISO: string,
    toISO: string,
    filters: { status?: string; area?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return countWhere(
      "hh_patients",
      `${SCOPE}.countPatientsScoped`,
      (q) => {
        let query = q.gte("created_at", fromISO).lt("created_at", toISO);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.area) {
          const term = filters.area.replace(/%/g, "");
          query = query.ilike("area", `%${term}%`);
        }
        return query;
      },
      opts
    );
  },

  async listPatientsScoped(
    fromISO: string,
    toISO: string,
    filters: { status?: string; area?: string } = {},
    paging: { limit?: number; offset?: number } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const limit = Math.max(1, Math.min(paging.limit ?? 50, REPORT_ROW_CEILING));
    const offset = Math.max(0, paging.offset ?? 0);
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_patients")
          .select("id, name, phone, area, city, status, shift, created_at")
          .gte("created_at", fromISO)
          .lt("created_at", toISO)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (filters.status) q = q.eq("status", filters.status);
        if (filters.area) {
          const term = filters.area.replace(/%/g, "");
          q = q.ilike("area", `%${term}%`);
        }
        return q;
      },
      `${SCOPE}.listPatientsScoped`
    );
  },

  async listPatientsForGroupBy(
    fromISO: string,
    toISO: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from("hh_patients")
          .select("id, status, area")
          .gte("created_at", fromISO)
          .lt("created_at", toISO)
          .range(0, REPORT_ROW_CEILING - 1),
      `${SCOPE}.listPatientsForGroupBy`
    );
  },

  /**
   * Count attendance rows inside the [from, to) window. Covers both the
   * timestamp-anchored `check_in_at` and the no-time `work_date` rows
   * (ABSENT / LEAVE / HOLIDAY) by running two counts and summing.
   */
  async countAttendanceScoped(
    startISO: string,
    endISO: string,
    filters: { employee_id?: string; status?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    // The "timed" and "no-time" branches are mutually exclusive on the same
    // row (a row only ever has check_in_at OR work_date filled), so we can
    // sum the two counts without double-counting.
    const timed = await countWhere(
      "hh_attendance",
      `${SCOPE}.countAttendanceScoped.timed`,
      (q) => {
        let query = q.gte("check_in_at", startISO).lt("check_in_at", endISO);
        if (filters.employee_id) query = query.eq("employee_id", filters.employee_id);
        if (filters.status) query = query.eq("status", filters.status);
        return query;
      },
      opts
    );
    if (!timed.success) return timed;
    const fromKey = startISO.slice(0, 10);
    const toKey = endISO.slice(0, 10);
    const untimed = await countWhere(
      "hh_attendance",
      `${SCOPE}.countAttendanceScoped.untimed`,
      (q) => {
        let query = q
          .is("check_in_at", null)
          .gte("work_date", fromKey)
          .lt("work_date", toKey);
        if (filters.employee_id) query = query.eq("employee_id", filters.employee_id);
        if (filters.status) query = query.eq("status", filters.status);
        return query;
      },
      opts
    );
    if (!untimed.success) return untimed;
    return { success: true, data: (timed.data || 0) + (untimed.data || 0) };
  },

  /**
   * Paginated attendance rows for the detail tab. Already covers both timed
   * and no-time rows via `listAttendanceInRange`, but slices to `limit/offset`
   * after the per-source merge so the caller doesn't double-pay window
   * scanning. Capped at `REPORT_ROW_CEILING`.
   */
  async listAttendanceScoped(
    startISO: string,
    endISO: string,
    filters: { employee_id?: string; status?: string } = {},
    paging: { limit?: number; offset?: number } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const limit = Math.max(1, Math.min(paging.limit ?? 50, REPORT_ROW_CEILING));
    const offset = Math.max(0, paging.offset ?? 0);
    const rows = await this.listAttendanceInRange(
      startISO,
      endISO,
      { employee_id: filters.employee_id },
      opts
    );
    if (!rows.success) return rows;
    const filtered = (rows.data || []).filter(
      (r) => !filters.status || String(r.status || "") === filters.status
    );
    filtered.sort((a, b) => {
      const ak = String(a.check_in_at || a.work_date || "");
      const bk = String(b.check_in_at || b.work_date || "");
      return bk.localeCompare(ak);
    });
    return {
      success: true,
      data: filtered.slice(offset, offset + limit)
    };
  },

  /** Count billings whose period activity touches [from, to). */
  countBillingsScoped(
    filters: { status?: string; patientId?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    return this.countBillings(filters, opts);
  },

  async listAttendanceInRange(
    startISO: string,
    endISO: string,
    filters: { employee_id?: string } = {},
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    const timed = await runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_attendance")
          .select("id, employee_id, status, hours, check_in_at, work_date")
          .gte("check_in_at", startISO)
          .lt("check_in_at", endISO);
        if (filters.employee_id) q = q.eq("employee_id", filters.employee_id);
        return q;
      },
      `${SCOPE}.listAttendanceInRange.timed`
    );
    if (!timed.success) return timed;

    const fromKey = startISO.slice(0, 10);
    const toKey = endISO.slice(0, 10);
    const noTime = await runListQuery<JsonRow>(
      () => {
        let q = db
          .from("hh_attendance")
          .select("id, employee_id, status, hours, check_in_at, work_date")
          .gte("work_date", fromKey)
          .lt("work_date", toKey);
        if (filters.employee_id) q = q.eq("employee_id", filters.employee_id);
        return q;
      },
      `${SCOPE}.listAttendanceInRange.noTime`
    );
    if (!noTime.success) return noTime;

    const seen = new Set<string>();
    const merged: JsonRow[] = [];
    for (const row of [...(timed.data || []), ...(noTime.data || [])]) {
      const id = String(row.id || "");
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
    return { success: true, data: merged };
  }
};

/** Helper exported for callers using yyyy-mm-dd boundaries. */
export function ymdRangeFromISO(isoFrom: string, isoTo: string): { from: string; to: string } {
  return { from: isoFrom.slice(0, 10), to: isoTo.slice(0, 10) };
}

/** Listing helper preserved for legacy callers. */
export { listAll };

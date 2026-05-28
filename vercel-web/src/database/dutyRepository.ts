import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";
import { sanitizeSearchTerm } from "@/utils/searchTerm";

const TABLE = "hh_duties";
const SVC = "hh_svc_entries";
const PAYOUT_CHARGES = "hh_payout_charges";
const RECEIPTS = "hh_receipts";
const SCOPE = "dutyRepository";

export interface DutyListFilters extends ListQuery {
  q?: string;
  employeeId?: string;
  patientId?: string;
  from?: string;
  to?: string;
  status?: string;
}

export const dutyRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  list(filters: DutyListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        // Employee filter must also match extra_partners rows so that the
        // calendar swimlane for a reassigned partner includes duties where
        // they are NOT the primary employee. We compare the JSONB column
        // via a containment ANY-of expression so any partner with this
        // employee_id qualifies.
        if (filters.employeeId) {
          const empId = filters.employeeId.replace(/"/g, '\\"');
          query = query.or(
            `employee_id.eq.${filters.employeeId},extra_partners.cs.[{"employee_id":"${empId}"}]`
          );
        }
        if (filters.patientId) query = query.eq("patient_id", filters.patientId);
        // Calendar overlap semantics: include a duty if its [start_at, end_at]
        // window touches the requested [from, to] window. Open-ended duties
        // (sentinel end_at = 2099-12-31) will still satisfy `end_at >= from`,
        // so they keep appearing on every month after their start.
        if (filters.to) query = query.lte("start_at", filters.to);
        if (filters.from) query = query.gte("end_at", filters.from);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.q) {
          const term = sanitizeSearchTerm(filters.q);
          if (term) {
            query = query.or(
              ["service_type", "shift_type", "status", "notes"]
                .map((c) => `${c}.ilike.%${term}%`)
                .join(",")
            );
          }
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "start_at", ascending: filters.ascending ?? false }
    );
  },

  /** Overlapping duties for same employee (excludes CANCELLED / NO_SHOW). */
  async findOverlapping(
    employeeId: string,
    startAt: string,
    endAt: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    const result = await runListQuery(
      () =>
        db
          .from(TABLE)
          .select("id, employee_id, patient_id, start_at, end_at, status")
          .eq("employee_id", employeeId)
          .not("status", "in", "(CANCELLED,NO_SHOW)")
          .lt("start_at", endAt)
          .gt("end_at", startAt),
      `${SCOPE}.findOverlapping`
    );
    if (!result.success) return result;
    const rows = (result.data || []).filter((r) => !excludeId || String(r.id) !== excludeId);
    return { success: true, data: rows };
  },

  /** Overlapping duties for same patient (excludes CANCELLED / NO_SHOW). */
  async findOverlappingForPatient(
    patientId: string,
    startAt: string,
    endAt: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    const result = await runListQuery(
      () =>
        db
          .from(TABLE)
          .select("id, employee_id, patient_id, start_at, end_at, status")
          .eq("patient_id", patientId)
          .not("status", "in", "(CANCELLED,NO_SHOW)")
          .lt("start_at", endAt)
          .gt("end_at", startAt),
      `${SCOPE}.findOverlappingForPatient`
    );
    if (!result.success) return result;
    const rows = (result.data || []).filter((r) => !excludeId || String(r.id) !== excludeId);
    return { success: true, data: rows };
  },

  /** Scheduled / in-progress duties for a patient — used when a bill closes. */
  async findActiveByPatient(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("patient_id", patientId)
          .in("status", ["SCHEDULED", "IN_PROGRESS"]),
      `${SCOPE}.findActiveByPatient`
    );
  },

  /** Scheduled / in-progress duties across all patients — used by daily extend cron. */
  async findActive(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(TABLE)
          .select("*")
          .in("status", ["SCHEDULED", "IN_PROGRESS"]),
      `${SCOPE}.findActive`
    );
  },

  /**
   * Duties for `employeeId` that overlap `period` (YYYY-MM) AND have
   * `payout_per_day` <= 0 (or null). Used by the payout repair flow to list
   * "duties needing a rate" and to bulk-set the rate.
   *
   * Note: we deliberately scan `employee_id` (primary partner) only. Extra
   * partners have their own per-row rates inside the `extra_partners` JSONB
   * and a different repair surface; the common case driving Gross=₹0 is the
   * primary employee being saved with rate=0.
   */
  async findZeroPayoutRateForEmployeePeriod(
    employeeId: string,
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!employeeId || !/^\d{4}-\d{2}$/.test(period)) {
      return { success: true, data: [] };
    }
    const [y, mo] = period.split("-").map((n) => parseInt(n, 10));
    const startIso = `${period}-01T00:00:00.000Z`;
    const lastDate = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const endIso = `${period}-${String(lastDate).padStart(2, "0")}T23:59:59.999Z`;
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select(
            "id, employee_id, patient_id, service_name, start_at, end_at, status, charge_per_day, payout_per_day"
          )
          .eq("employee_id", employeeId)
          .not("status", "in", "(CANCELLED,NO_SHOW)")
          .lte("start_at", endIso)
          .gte("end_at", startIso)
          .or("payout_per_day.is.null,payout_per_day.eq.0"),
      `${SCOPE}.findZeroPayoutRateForEmployeePeriod`
    );
    return result;
  },

  /**
   * Set `payout_per_day` for every primary-employee duty matching
   * (employeeId, period) where the existing rate is null or 0. Returns the
   * ids that were touched. Use the diary materializer + payout recompute to
   * fan the new rate into hh_payout_charges and hh_payouts.
   */
  async bulkSetPayoutRateForEmployeePeriod(
    employeeId: string,
    period: string,
    payoutPerDay: number,
    actorEmail: string,
    opts?: DbAccess
  ): Promise<ApiResult<{ updated_ids: string[] }>> {
    const zeros = await this.findZeroPayoutRateForEmployeePeriod(employeeId, period, opts);
    if (!zeros.success) {
      return {
        success: false,
        error: zeros.error,
        code: zeros.code,
        details: zeros.details
      };
    }
    const ids = (zeros.data || []).map((row) => String(row.id));
    if (!ids.length) return { success: true, data: { updated_ids: [] } };
    const db = resolveClient(opts);
    const patch: JsonRow = {
      payout_per_day: payoutPerDay,
      updated_by: actorEmail || "system",
      updated_at: new Date().toISOString()
    };
    const result = await runQuery<null>(
      () =>
        db
          .from(TABLE)
          .update(patch)
          .in("id", ids)
          .then(({ error }) => ({ data: null, error })),
      `${SCOPE}.bulkSetPayoutRateForEmployeePeriod`
    );
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        code: result.code,
        details: result.details
      };
    }
    return { success: true, data: { updated_ids: ids } };
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(TABLE, row, SCOPE, opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(TABLE, id, patch, SCOPE, opts);
  },

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(TABLE, id, SCOPE, opts);
  },

  /** Service-entry rows generated by a given duty within its billing record. */
  async findSvcEntriesForDuty(
    billingId: string,
    dutyId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(SVC)
          .select("id, billing_id, remarks")
          .eq("billing_id", billingId)
          .eq("remarks", `duty:${dutyId}`),
      `${SCOPE}.findSvcEntriesForDuty`
    );
  },

  /** Remove the service-entry rows generated by a duty (safe billing rollback). */
  async removeSvcEntriesForDuty(
    billingId: string,
    dutyId: string,
    opts?: DbAccess
  ): Promise<ApiResult<null>> {
    const db = resolveClient(opts);
    return runQuery<null>(
      () =>
        db
          .from(SVC)
          .delete()
          .eq("billing_id", billingId)
          .eq("remarks", `duty:${dutyId}`)
          .then(({ error }) => ({ data: null, error })),
      `${SCOPE}.removeSvcEntriesForDuty`
    );
  },

  /** All svc rows materialized from a duty (`duty:<id>:...` remarks). */
  async findSvcEntriesByDutyId(dutyId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(SVC)
          .select("id, billing_id, svc_key, date, partner_id, partner, remarks, total, amt, updated_at")
          .like("remarks", `duty:${dutyId}:%`),
      `${SCOPE}.findSvcEntriesByDutyId`
    );
  },

  async removeSvcEntriesByDutyId(dutyId: string, opts?: DbAccess): Promise<ApiResult<null>> {
    const db = resolveClient(opts);
    return runQuery<null>(
      () =>
        db
          .from(SVC)
          .delete()
          .like("remarks", `duty:${dutyId}:%`)
          .then(({ error }) => ({ data: null, error })),
      `${SCOPE}.removeSvcEntriesByDutyId`
    );
  },

  async findPayoutChargesByDutyId(dutyId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(PAYOUT_CHARGES)
          .select("id, svc_key, date, partner_id, partner, amount, remarks, updated_at")
          .like("remarks", `duty:${dutyId}:%`),
      `${SCOPE}.findPayoutChargesByDutyId`
    );
  },

  async removePayoutChargesByDutyId(dutyId: string, opts?: DbAccess): Promise<ApiResult<null>> {
    const db = resolveClient(opts);
    return runQuery<null>(
      () =>
        db
          .from(PAYOUT_CHARGES)
          .delete()
          .like("remarks", `duty:${dutyId}:%`)
          .then(({ error }) => ({ data: null, error })),
      `${SCOPE}.removePayoutChargesByDutyId`
    );
  },

  /** Count live (non-deleted) receipts attached to a billing. */
  async countActiveReceipts(billingId: string, opts?: DbAccess): Promise<ApiResult<number>> {
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(RECEIPTS)
          .select("id")
          .eq("billing_id", billingId)
          .is("deleted_at", null),
      `${SCOPE}.countActiveReceipts`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  }
};

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  resolveClient,
  callRpc
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";
import { sanitizeSearchTerm } from "@/utils/searchTerm";
import { DUTY_INACTIVE_STATUS_FILTER } from "@/business/dutyRules";

const TABLE = "hh_duties";
const SVC = "hh_svc_entries";
const PAYOUT_CHARGES = "hh_payout_charges";
const RECEIPTS = "hh_receipts";
const BILLINGS = "hh_billings";
const SCOPE = "dutyRepository";

export interface DutyListFilters extends ListQuery {
  q?: string;
  employeeId?: string;
  patientId?: string;
  from?: string;
  to?: string;
  status?: string;
}

export interface BulkDutyMaterializeResult {
  ok: boolean;
  from: string;
  to: string;
  candidate_rows: number;
  created_svc: number;
  created_payout: number;
}

export interface DutyLedgerSyncResult {
  ok: boolean;
  attendance?: {
    ok?: boolean;
    from?: string;
    to?: string;
    inserted_attendance?: number;
  };
  payout?: {
    ok?: boolean;
    from?: string;
    to?: string;
    updated_payouts?: number;
    inserted_payouts?: number;
    payout_gross_mismatch_groups?: number;
    attendance_charge_gap_groups?: number;
    attendance_duplicate_groups?: number;
  };
}

export interface DutyMasterReconciliationReport {
  ok: boolean;
  from: string;
  to: string;
  rules: string[];
  summary: {
    expected_duty_day_rows: number;
    expected_bill_amount: number;
    expected_payout_amount: number;
    service_rows: number;
    service_amount: number;
    payout_rows: number;
    payout_amount: number;
    missing_service_rows: number;
    missing_payout_rows: number;
    duplicate_service_groups: number;
    duplicate_payout_groups: number;
    orphan_service_rows: number;
    orphan_payout_rows: number;
    patient_billing_mismatch_groups: number;
    employee_payout_mismatch_groups: number;
  };
  patient_billing_mismatches: Array<{
    patient_id: string;
    expected_amount: number;
    actual_amount: number;
    difference: number;
  }>;
  employee_payout_mismatches: Array<{
    employee_id: string;
    expected_amount: number;
    actual_amount: number;
    difference: number;
  }>;
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
        if (filters.status) {
          query = query.eq("status", filters.status);
        } else {
          // Calendar default: hide soft-deleted duties unless explicitly requested.
          query = query.neq("status", "DELETED");
        }
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
          .not("status", "in", DUTY_INACTIVE_STATUS_FILTER)
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
          .not("status", "in", DUTY_INACTIVE_STATUS_FILTER)
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

  /**
   * Every non-cancelled duty for a patient — used when reconciling the
   * billing ledger to the duty calendar. Includes COMPLETED duties so a
   * backfill can create svc_entries for days the calendar already paints
   * (the nightly cron only walks SCHEDULED / IN_PROGRESS duties).
   */
  async findMaterializableByPatient(
    patientId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("patient_id", patientId)
          .not("status", "in", DUTY_INACTIVE_STATUS_FILTER),
      `${SCOPE}.findMaterializableByPatient`
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
   * Active duties that still need a ledger row for `today` (YYYY-MM-DD).
   * Cron uses this instead of scanning every active duty, which kept the
   * production sync request open too long on busy days.
   */
  async findActiveNeedingExtension(
    today: string,
    limit: number,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
    const capped = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
    const nowIso = `${day}T23:59:59.999Z`;
    const db = resolveClient(opts);
    const activeBills = await runListQuery<JsonRow>(
      () =>
        db
          .from(BILLINGS)
          .select("patient_id")
          .eq("status", "Active")
          .limit(1000),
      `${SCOPE}.findActiveNeedingExtension.activeBills`
    );
    if (!activeBills.success) return activeBills;
    const activePatientIds = Array.from(
      new Set(
        (activeBills.data || [])
          .map((row) => String(row.patient_id || "").trim())
          .filter(Boolean)
      )
    );
    if (activePatientIds.length === 0) {
      return { success: true, data: [] };
    }

    const active = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .in("status", ["SCHEDULED", "IN_PROGRESS"])
          .in("patient_id", activePatientIds)
          .lte("start_at", nowIso)
          .order("start_at", { ascending: true })
          .limit(250),
      `${SCOPE}.findActiveNeedingExtension.active`
    );
    if (!active.success) return active;

    const todayRows = await runListQuery<JsonRow>(
      () =>
        db
          .from(SVC)
          .select("remarks")
          .like("remarks", `duty:%:${day}:%`)
          .limit(1000),
      `${SCOPE}.findActiveNeedingExtension.todayRows`
    );
    if (!todayRows.success) return todayRows;

    const materializedIds = new Set(
      (todayRows.data || [])
        .map((row) => String(row.remarks || "").split(":")[1] || "")
        .filter(Boolean)
    );
    return {
      success: true,
      data: (active.data || [])
        .filter((row) => !materializedIds.has(String(row.id || "")))
        .slice(0, capped)
    };
  },

  bulkMaterializeDueDutyDays(
    from: string,
    to: string,
    limit: number,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<BulkDutyMaterializeResult | null>> {
    const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date().toISOString().slice(0, 10);
    const toDay = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : fromDay;
    const capped = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 500)));
    return callRpc<BulkDutyMaterializeResult>(
      "hominal_materialize_due_duty_days",
      {
        p_from: fromDay,
        p_to: toDay,
        p_limit: capped,
        p_actor: actor || "cron@hominal.system"
      },
      SCOPE,
      opts
    );
  },

  syncDutyAttendancePayoutLedger(
    from: string,
    to: string,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<DutyLedgerSyncResult | null>> {
    const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date().toISOString().slice(0, 10);
    const toDay = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : fromDay;
    return callRpc<DutyLedgerSyncResult>(
      "hominal_sync_duty_attendance_payout",
      {
        p_from: fromDay,
        p_to: toDay,
        p_actor: actor || "cron@hominal.system"
      },
      SCOPE,
      opts
    );
  },

  dutyMasterReconciliationReport(
    from: string,
    to: string,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<DutyMasterReconciliationReport | null>> {
    const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date().toISOString().slice(0, 10);
    const toDay = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : fromDay;
    return callRpc<DutyMasterReconciliationReport>(
      "hominal_duty_reconciliation_report",
      {
        p_from: fromDay,
        p_to: toDay,
        p_actor: actor || "reconciliation@hominal.system"
      },
      SCOPE,
      opts
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
    const [y = 0, mo = 1] = period.split("-").map((n) => parseInt(n, 10));
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
          .not("status", "in", DUTY_INACTIVE_STATUS_FILTER)
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
          .eq("duty_id", dutyId),
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
          .eq("duty_id", dutyId)
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
          .select("id, billing_id, svc_key, date, partner_id, partner, remarks, total, amt, updated_at, duty_id")
          .eq("duty_id", dutyId),
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
          .eq("duty_id", dutyId)
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
          .select("id, svc_key, date, partner_id, partner, amount, remarks, updated_at, duty_id")
          .eq("duty_id", dutyId),
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
          .eq("duty_id", dutyId)
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

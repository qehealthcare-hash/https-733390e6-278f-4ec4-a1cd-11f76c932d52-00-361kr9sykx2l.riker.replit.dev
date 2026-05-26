/**
 * Duty-day ledger repository (Phase 11).
 *
 * Backs `public.hh_duty_days` — the per-day join between svc_entries (patient
 * billing) and payout_charges (staff payout). Writes are restricted to the
 * service role at the database level (RLS allows read-only for authenticated
 * users). All calls here use the admin client.
 *
 * Cut-over plan: Phase 11 only writes the ledger in parallel with the existing
 * receipt / payout flows. Phase 11b will refactor `hominal_save_receipt` and
 * the payout RPCs to derive their effects from this ledger transactionally.
 *
 * Callers (billingService, payoutService, svc-entry replace path) MUST treat
 * every method here as best-effort — wrap calls in try/catch and log to
 * `console.error("[dutyDayLedger] ...")`. A ledger failure must never break
 * the user-visible action until cut-over.
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow } from "@/database/types";
import { resolveClient } from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";

const TABLE = "hh_duty_days";
const SCOPE = "dutyDayRepository";

export interface SvcEntryShape {
  id: string;
  svc_key?: string | null;
  billing_id?: string | null;
  service_name?: string | null;
  partner_id?: string | null;
  partner?: string | null;
  date?: string | null;
  count?: number | string | null;
  amt?: number | string | null;
  /** Optional explicit patient_id — when omitted, callers should resolve via billing. */
  patient_id?: string | null;
  shift_type?: string | null;
  staff_rate?: number | string | null;
  remarks?: string | null;
}

/** Validated YYYY-MM-DD or null. */
function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function nonZeroOrOne(value: number | string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
}

function addDays(ymd: string, offset: number): string {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offset);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Expand a single svc_entry row into the per-day rows that should exist in
 * `hh_duty_days`. Returns an empty list when the input is malformed (caller
 * decides whether to soft-delete or skip).
 */
export function expandSvcEntryToDayRows(entry: SvcEntryShape): JsonRow[] {
  const baseDate = normalizeDate(entry.date);
  if (!baseDate) return [];
  const days = nonZeroOrOne(entry.count);
  const employeeId = (entry.partner_id || "").trim() || null;
  const rate = entry.amt != null ? Number(entry.amt) : null;
  const rows: JsonRow[] = [];
  for (let i = 0; i < days; i += 1) {
    rows.push({
      svc_entry_id: entry.id,
      billing_id: (entry.billing_id || "").trim() || null,
      patient_id: (entry.patient_id || "").trim() || null,
      employee_id: employeeId,
      service_name: String(entry.service_name || "").trim(),
      service_date: addDays(baseDate, i),
      shift_type: entry.shift_type || null,
      patient_rate: rate != null && Number.isFinite(rate) ? rate : null,
      staff_rate:
        entry.staff_rate != null && Number.isFinite(Number(entry.staff_rate))
          ? Number(entry.staff_rate)
          : null
    });
  }
  return rows;
}

export const dutyDayRepository = {
  /** All non-deleted day-rows for a billing, oldest first. */
  listByBilling(billingId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    if (!billingId) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("billing_id", billingId)
          .is("deleted_at", null)
          .order("service_date", { ascending: true }),
      `${SCOPE}.listByBilling`
    );
  },

  /**
   * Non-deleted day-rows for an employee within a date range. Used by the
   * payout side of the ledger and by reports. `from` and `to` are inclusive
   * YYYY-MM-DD strings.
   */
  listByEmployeePeriod(
    employeeId: string,
    from: string,
    to: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!employeeId) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("employee_id", employeeId)
          .gte("service_date", from)
          .lte("service_date", to)
          .is("deleted_at", null)
          .order("service_date", { ascending: true }),
      `${SCOPE}.listByEmployeePeriod`
    );
  },

  /** Day-rows attached to a given svc_entry (used for soft-delete cascade). */
  listByEntryId(entryId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    if (!entryId) return Promise.resolve({ success: true, data: [] });
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("svc_entry_id", entryId)
          .is("deleted_at", null),
      `${SCOPE}.listByEntryId`
    );
  },

  /**
   * Mark a set of day-rows as paid by a patient receipt. Idempotent — does
   * not overwrite an existing `paid_receipt_id` link with a different value
   * (would indicate two receipts claiming the same day; callers must release
   * the previous receipt first).
   */
  async markPaidToPatient(
    receiptId: string,
    ids: string[],
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!receiptId || !unique.length) {
      return { success: true, data: 0 };
    }
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .update({
            paid_receipt_id: receiptId,
            paid_to_patient_at: new Date().toISOString(),
            updated_by: actor
          })
          .in("id", unique)
          .is("paid_receipt_id", null)
          .is("deleted_at", null)
          .select("id"),
      `${SCOPE}.markPaidToPatient`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  },

  /** Release every day-row currently linked to the receipt. */
  async releaseFromPatient(
    receiptId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    if (!receiptId) return { success: true, data: 0 };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .update({
            paid_receipt_id: null,
            paid_to_patient_at: null,
            updated_by: actor
          })
          .eq("paid_receipt_id", receiptId)
          .select("id"),
      `${SCOPE}.releaseFromPatient`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  },

  /** Mark day-rows as paid out to staff (linked to a payout_charge row). */
  async markPaidToStaff(
    chargeId: string,
    ids: string[],
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    if (!chargeId || !unique.length) {
      return { success: true, data: 0 };
    }
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .update({
            paid_charge_id: chargeId,
            paid_to_staff_at: new Date().toISOString(),
            updated_by: actor
          })
          .in("id", unique)
          .is("paid_charge_id", null)
          .is("deleted_at", null)
          .select("id"),
      `${SCOPE}.markPaidToStaff`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  },

  /** Release every day-row currently linked to the payout charge. */
  async releaseFromStaff(
    chargeId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    if (!chargeId) return { success: true, data: 0 };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .update({
            paid_charge_id: null,
            paid_to_staff_at: null,
            updated_by: actor
          })
          .eq("paid_charge_id", chargeId)
          .select("id"),
      `${SCOPE}.releaseFromStaff`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  },

  /**
   * Soft-delete every active day-row for a svc_entry. Idempotent: returns
   * the number of rows transitioned to `deleted_at IS NOT NULL`.
   */
  async softDeleteByEntryId(
    entryId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    if (!entryId) return { success: true, data: 0 };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: actor,
            updated_by: actor
          })
          .eq("svc_entry_id", entryId)
          .is("deleted_at", null)
          .select("id"),
      `${SCOPE}.softDeleteByEntryId`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  },

  /**
   * Insert or refresh the day-rows that should exist for a single
   * svc_entry. Returns the number of rows persisted (one per day in the
   * expanded range; if the svc_entry has count > 1 multiple rows are
   * upserted).
   *
   * Idempotency is enforced by the partial unique index
   * `uq_hh_duty_days_svc_entry_day_active(svc_entry_id, service_date)`
   * filtered on `deleted_at IS NULL`.
   */
  async upsertFromSvcEntry(
    entry: SvcEntryShape,
    actor: string,
    opts?: DbAccess
  ): Promise<ApiResult<number>> {
    const rows = expandSvcEntryToDayRows(entry);
    if (!rows.length) {
      return { success: true, data: 0 };
    }
    const db = resolveClient(opts);
    const stamped = rows.map((row) => ({
      ...row,
      created_by: actor,
      updated_by: actor
    }));
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .upsert(stamped, {
            onConflict: "svc_entry_id,service_date",
            ignoreDuplicates: false
          })
          .select("id"),
      `${SCOPE}.upsertFromSvcEntry`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length };
  },

  /** Single-row fetch — used by tests and ad-hoc audit tools. */
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    if (!id) return Promise.resolve({ success: true, data: null });
    const db = resolveClient(opts);
    return runQuery<JsonRow>(
      () => db.from(TABLE).select("*").eq("id", id).maybeSingle(),
      `${SCOPE}.findById`
    );
  }
};

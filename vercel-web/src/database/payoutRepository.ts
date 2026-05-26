import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  callRpc,
  upsertRow,
  listAll,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";

const PAYOUTS = "hh_payouts";
const PAID_TX = "hh_paid_transactions";
const CHARGES = "hh_payout_charges";
const SCOPE = "payoutRepository";

/**
 * `period` is YYYY-MM; return the first day of the *next* month as YYYY-MM-DD.
 * Used to bound a half-open `[period-01, nextMonth-01)` date range filter
 * against Supabase's text date columns.
 */
function monthEndExclusive(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return `${period}-32`;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear.toString().padStart(4, "0")}-${nextMonth.toString().padStart(2, "0")}-01`;
}

export interface PayoutListFilters extends ListQuery {
  period?: string;
  employeeId?: string;
  status?: string;
  q?: string;
}

export const payoutRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(PAYOUTS, id, SCOPE, opts);
  },

  /**
   * Race-safe natural-key lookup matching the
   * `hh_payouts_unique (employee_id, period_month)` constraint.
   */
  findByEmployeePeriod(
    employeeId: string,
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(PAYOUTS)
          .select("*")
          .eq("employee_id", employeeId)
          .eq("period_month", period)
          .maybeSingle(),
      `${SCOPE}.findByEmployeePeriod`
    );
  },

  list(filters: PayoutListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      PAYOUTS,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.period) query = query.eq("period_month", filters.period);
        if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.q) {
          const term = filters.q.replace(/%/g, "");
          query = query.or(
            ["id", "employee_id", "period_month", "status", "remarks"]
              .map((c) => `${c}.ilike.%${term}%`)
              .join(",")
          );
        }
        return query;
      },
      {
        ...opts,
        ...filters,
        orderBy: filters.orderBy ?? "period_month",
        ascending: filters.ascending ?? false
      }
    );
  },

  listByPeriod(period: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(PAYOUTS, SCOPE, (q) => q.eq("period_month", period), {
      ...opts,
      orderBy: "net_amount",
      ascending: false
    });
  },

  /** Sum of net_amount for a period — dashboard total parity. */
  async sumNetForPeriod(
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<{ total: number; rowCount: number; rows: JsonRow[] }>> {
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(PAYOUTS)
          .select("id, employee_id, gross_amount, advance, deduction, bonus, net_amount, status")
          .eq("period_month", period),
      `${SCOPE}.sumNetForPeriod`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    const rows = result.data || [];
    const total = rows.reduce((sum, r) => sum + Number(r.net_amount || 0), 0);
    return { success: true, data: { total, rowCount: rows.length, rows } };
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(PAYOUTS, row, SCOPE, opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(PAYOUTS, id, patch, SCOPE, opts);
  },

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(PAYOUTS, id, SCOPE, opts);
  },

  /** Recompute gross/net from duties + attendance for employee + YYYY-MM. */
  recomputeRpc(
    employeeId: string,
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<{ payout_id?: string; gross?: number; duties?: number; hours?: number } | null>> {
    return callRpc<{ payout_id?: string; gross?: number; duties?: number; hours?: number }>(
      "hh_recompute_payout",
      { p_employee_id: employeeId, p_period: period },
      SCOPE,
      opts
    );
  },

  /**
   * @deprecated Use `insertPaidTransaction` — upsert on payout id prevents
   * multiple disbursements (advance + final) per payout.
   */
  upsertPaidTransaction(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return upsertRow(PAID_TX, row, `${SCOPE}.paidTx`, opts, "id");
  },

  /**
   * Insert a single disbursement row. New rows must carry an `id`, a
   * `serial_no` (allocated via `hh_next_paid_tx_serial`), and `payout_id`
   * so the audit ledger ties cleanly back to the source payout.
   */
  insertPaidTransaction(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(PAID_TX, row, `${SCOPE}.insertPaidTx`, opts);
  },

  /** All disbursements (ADVANCE + FINAL) for one payout, ordered oldest-first. */
  listPaidTransactionsByPayout(
    payoutId: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    return listAll(PAID_TX, `${SCOPE}.listByPayout`, (q) => q.eq("payout_id", payoutId), {
      ...opts,
      orderBy: "created_at",
      ascending: true
    });
  },

  /**
   * All disbursements for an (employee, period) pair, including legacy rows
   * that pre-date the `payout_id` / `period_month` columns. Used by the
   * `pending payout` query and the duty-calendar drill-through.
   */
  async listPaidTransactionsByEmployeePeriod(
    employeeId: string,
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!employeeId || !period) return { success: true, data: [] };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(PAID_TX)
          .select("*")
          .or(`employee_id.eq.${employeeId},partner.eq.${employeeId}`)
          .order("created_at", { ascending: true }),
      `${SCOPE}.listByEmployeePeriod`
    );
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        code: result.code,
        details: result.details
      };
    }
    const rows = (result.data || []).filter((row) => {
      const pm = String(row.period_month || "").trim();
      if (pm === period) return true;
      if (pm) return false;
      const paidOn = String(row.paid_on || "").trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(paidOn)) {
        return paidOn.slice(0, 7) === period;
      }
      const created = String(row.created_at || "");
      if (created) {
        return created.slice(0, 7) === period;
      }
      return false;
    });
    return { success: true, data: rows };
  },

  /** Allocate the next `PTXYYYY######` audit-grade serial (race-safe). */
  nextPaidTxSerialRpc(opts?: DbAccess): Promise<ApiResult<string | null>> {
    return callRpc<string>(
      "hh_next_paid_tx_serial",
      {},
      `${SCOPE}.nextPaidTxSerial`,
      opts
    );
  },

  /**
   * Single-source-of-truth "pending payout" calculation for an (employee,
   * period) pair, computed directly from the duty calendar
   * (`hh_payout_charges`) minus any disbursements already recorded in
   * `hh_paid_transactions`. Works even before an `hh_payouts` row exists.
   */
  /**
   * Every employee who still has an unpaid balance for `period`, with their
   * charged/paid totals. Backed by `hh_employees_pending_for_period(p_period)`
   * (migration 043). Used by the "Unpaid employees" board on the payouts page.
   */
  pendingEmployeesForPeriodRpc(
    period: string,
    opts?: DbAccess
  ): Promise<
    ApiResult<
      | Array<{
          employee_id: string;
          charged: number;
          paid: number;
          pending: number;
          duty_count: number;
        }>
      | null
    >
  > {
    return callRpc<
      Array<{
        employee_id: string;
        charged: number;
        paid: number;
        pending: number;
        duty_count: number;
      }>
    >(
      "hh_employees_pending_for_period",
      { p_period: period },
      `${SCOPE}.pendingEmployeesForPeriod`,
      opts
    );
  },

  pendingPayoutRpc(
    employeeId: string,
    period: string,
    opts?: DbAccess
  ): Promise<
    ApiResult<{
      employee_id: string;
      period_month: string;
      charged: number;
      paid: number;
      pending: number;
      duty_count: number;
    } | null>
  > {
    return callRpc<{
      employee_id: string;
      period_month: string;
      charged: number;
      paid: number;
      pending: number;
      duty_count: number;
    }>(
      "hh_employee_pending_payout",
      { p_employee_id: employeeId, p_period: period },
      `${SCOPE}.pendingPayout`,
      opts
    );
  },

  /**
   * True if a given (employee_id, isoDate) is already disbursed via
   * hh_paid_transactions. Used by the per-day diary editor to refuse
   * mutations that would break payment reconciliation.
   */
  async isDayPaid(
    employeeId: string,
    isoDate: string,
    opts?: DbAccess
  ): Promise<ApiResult<boolean>> {
    if (!employeeId || !isoDate) return { success: true, data: false };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(PAID_TX)
          .select("id, paid_dates, from_date, to_date")
          .eq("employee_id", employeeId)
          .or(
            `paid_dates.cs.{${isoDate}},and(from_date.lte.${isoDate},to_date.gte.${isoDate})`
          )
          .limit(1),
      `${SCOPE}.isDayPaid`
    );
    if (!result.success) {
      return { success: false, error: result.error, code: result.code, details: result.details };
    }
    return { success: true, data: (result.data || []).length > 0 };
  },

  /**
   * True if ANY of the supplied (employee_id, isoDate) slots appear in
   * hh_paid_transactions. Used before duty cancel / hard-delete rolls back
   * diary rows that were already disbursed.
   */
  async anyDayPaid(
    slots: Array<{ employee_id: string; iso_date: string }>,
    opts?: DbAccess
  ): Promise<ApiResult<{ paid: boolean; employee_id?: string; iso_date?: string }>> {
    const unique = Array.from(
      new Map(
        (slots || [])
          .map((s) => ({
            employee_id: String(s.employee_id || "").trim(),
            iso_date: String(s.iso_date || "").trim()
          }))
          .filter((s) => s.employee_id && s.iso_date)
          .map((s) => [`${s.employee_id}|${s.iso_date}`, s] as const)
      ).values()
    );
    for (const slot of unique) {
      const hit = await payoutRepository.isDayPaid(slot.employee_id, slot.iso_date, opts);
      if (!hit.success) {
        return {
          success: false,
          error: hit.error,
          code: hit.code,
          details: hit.details
        };
      }
      if (hit.data) {
        return { success: true, data: { paid: true, employee_id: slot.employee_id, iso_date: slot.iso_date } };
      }
    }
    return { success: true, data: { paid: false } };
  },

  findPaidTransaction(payoutId: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(PAID_TX, payoutId, `${SCOPE}.paidTx`, opts);
  },

  /** All payout-charge rows for a `svc_key` (used by ledger sync). */
  async listChargesBySvcKey(
    svcKey: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!svcKey) return { success: true, data: [] };
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(CHARGES)
          .select("*")
          .eq("svc_key", svcKey)
          .order("date", { ascending: true }),
      `${SCOPE}.listChargesBySvcKey`
    );
  },

  /**
   * Period-scoped payout charges for an employee (duty calendar source rows).
   * `hh_payout_charges` has no `payout_id` column — match partner_id / partner.
   */
  async listChargesByEmployeePeriod(
    employeeId: string,
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!employeeId || !period) return { success: true, data: [] };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(CHARGES)
          .select("*")
          .or(
            `partner_id.eq.${employeeId},partner.eq.${employeeId}`
          )
          .order("date", { ascending: true }),
      `${SCOPE}.listChargesByEmployeePeriod`
    );
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        code: result.code,
        details: result.details
      };
    }
    const rows = (result.data || []).filter((row) => {
      const dateStr = String(row.date || "");
      if (dateStr.length >= 7 && dateStr.slice(0, 7) === period) return true;
      const created = String(row.created_at || "");
      return created.length >= 7 && created.slice(0, 7) === period;
    });
    return { success: true, data: rows };
  },

  insertCharge(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(CHARGES, row, `${SCOPE}.insertCharge`, opts);
  },

  /**
   * Period-scoped charges across *every* employee. Used as a fallback for the
   * "Unpaid employees" board when the `hh_employees_pending_for_period` RPC
   * is unavailable (e.g. migration 043 not yet applied on this Supabase).
   */
  async listAllChargesForPeriod(
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!period) return { success: true, data: [] };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(CHARGES)
          .select("*")
          .gte("date", `${period}-01`)
          .lt("date", monthEndExclusive(period))
          .order("date", { ascending: true }),
      `${SCOPE}.listAllChargesForPeriod`
    );
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        code: result.code,
        details: result.details
      };
    }
    return { success: true, data: result.data || [] };
  },

  /**
   * Period-scoped disbursements across *every* employee. Same fallback role
   * as `listAllChargesForPeriod` — keeps the unpaid-employees board working
   * even without the aggregating RPC.
   */
  async listAllPaidTransactionsForPeriod(
    period: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!period) return { success: true, data: [] };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(PAID_TX)
          .select("*")
          .order("created_at", { ascending: true }),
      `${SCOPE}.listAllPaidTransactionsForPeriod`
    );
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        code: result.code,
        details: result.details
      };
    }
    const rows = (result.data || []).filter((row) => {
      const pm = String(row.period_month || "").trim();
      if (pm === period) return true;
      if (pm) return false;
      const paidOn = String(row.paid_on || "").trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(paidOn)) {
        return paidOn.slice(0, 7) === period;
      }
      const created = String(row.created_at || "");
      if (created) {
        return created.slice(0, 7) === period;
      }
      return false;
    });
    return { success: true, data: rows };
  },

  /**
   * Replace the entire `hh_payout_charges` slice for a given `svc_key`.
   * Backed by `hominal_replace_payout_charges(p_svc_key, p_rows)`. Returns
   * the row count inserted.
   */
  replacePayoutChargesRpc(
    svcKey: string,
    rows: JsonRow[],
    opts?: DbAccess
  ): Promise<ApiResult<number | null>> {
    return callRpc<number>(
      "hominal_replace_payout_charges",
      { p_svc_key: svcKey, p_rows: rows },
      `${SCOPE}.replacePayoutChargesRpc`,
      opts
    );
  }
};

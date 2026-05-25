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

  upsertPaidTransaction(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return upsertRow(PAID_TX, row, `${SCOPE}.paidTx`, opts, "id");
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

  listChargesByPayout(payoutId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(CHARGES, SCOPE, (q) => q.eq("payout_id", payoutId), opts);
  },

  insertCharge(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(CHARGES, row, `${SCOPE}.insertCharge`, opts);
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

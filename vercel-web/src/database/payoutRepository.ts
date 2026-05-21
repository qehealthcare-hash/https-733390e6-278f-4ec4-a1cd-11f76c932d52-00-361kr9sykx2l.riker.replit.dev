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
  listAll
} from "@/database/baseRepository";

const PAYOUTS = "hh_payouts";
const PAID_TX = "hh_paid_transactions";
const CHARGES = "hh_payout_charges";
const SCOPE = "payoutRepository";

export interface PayoutListFilters extends ListQuery {
  period?: string;
  employeeId?: string;
  status?: string;
}

export const payoutRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(PAYOUTS, id, SCOPE, opts);
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
  ): Promise<ApiResult<{ payout_id?: string } | null>> {
    return callRpc<{ payout_id?: string }>(
      "hh_recompute_payout",
      { p_employee_id: employeeId, p_period: period },
      SCOPE,
      opts
    );
  },

  upsertPaidTransaction(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return upsertRow(PAID_TX, row, `${SCOPE}.paidTx`, opts, "id");
  },

  listChargesByPayout(payoutId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(CHARGES, SCOPE, (q) => q.eq("payout_id", payoutId), opts);
  },

  insertCharge(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(CHARGES, row, `${SCOPE}.insertCharge`, opts);
  }
};

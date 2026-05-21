import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow } from "@/database/types";
import { countWhere, monthRange, listAll, resolveClient } from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const SCOPE = "reportRepository";

/** Raw count/aggregate rows for dashboard — no derived KPI math here. */
export const reportRepository = {
  monthRange,

  countActivePatients(opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_patients", SCOPE, (q) => q.eq("status", "Active"), opts);
  },

  countAllPatients(opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_patients", SCOPE, (q) => q, opts);
  },

  countInquiriesInRange(startISO: string, endISO: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere(
      "hh_inquiries",
      SCOPE,
      (q) => q.gte("created_at", startISO).lt("created_at", endISO),
      opts
    );
  },

  countDutiesScheduledInRange(startISO: string, endISO: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere(
      "hh_duties",
      SCOPE,
      (q) =>
        q.gte("start_at", startISO).lt("start_at", endISO).in("status", ["SCHEDULED", "IN_PROGRESS"]),
      opts
    );
  },

  countDutiesCompletedInRange(startISO: string, endISO: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere(
      "hh_duties",
      SCOPE,
      (q) => q.gte("start_at", startISO).lt("start_at", endISO).eq("status", "COMPLETED"),
      opts
    );
  },

  countOpenBillings(opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_billings", SCOPE, (q) => q.eq("status", "Active"), opts);
  },

  /** Receipt amounts for month window (caller sums). */
  listReceiptAmountsInRange(startISO: string, endISO: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db.from("hh_receipts").select("amount").gte("created_at", startISO).lt("created_at", endISO),
      `${SCOPE}.listReceiptAmountsInRange`
    );
  },

  listPayoutsForPeriod(period: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(
      "hh_payouts",
      SCOPE,
      (q) => q.eq("period_month", period),
      { ...opts, select: "gross_amount, net_amount, status" }
    );
  },

  listPaidPayoutsForPeriod(period: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from("hh_payouts")
          .select("net_amount")
          .eq("period_month", period)
          .eq("status", "PAID"),
      `${SCOPE}.listPaidPayoutsForPeriod`
    );
  },

  listPayrollRows(period: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(
      "hh_payouts",
      SCOPE,
      (q) => q.eq("period_month", period),
      {
        ...opts,
        select:
          "id, employee_id, period_month, gross_amount, advance, deduction, bonus, net_amount, status, duty_count, hours",
        orderBy: "net_amount",
        ascending: false
      }
    );
  }
};

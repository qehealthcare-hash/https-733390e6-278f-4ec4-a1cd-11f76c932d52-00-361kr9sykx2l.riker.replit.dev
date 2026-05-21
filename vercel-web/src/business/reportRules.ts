import { monthRangeUTC } from "@/business/dateRules";
import { payoutOutstanding, computePayoutNet } from "@/business/payoutRules";
import { sumReceiptAmounts } from "@/business/billingRules";
import {
  aggregateAttendanceByEmployee,
  type AttendanceRollup,
  type AttendanceRollupRow
} from "@/business/attendanceRules";

export { monthRangeUTC };

export interface DashboardRawCounts {
  patients_active: number;
  patients_total: number;
  inquiries_this_month: number;
  duties_scheduled: number;
  duties_completed: number;
  billings_open: number;
  receipt_amounts: Array<{ amount?: number | string | null }>;
  payout_rows: Array<{ gross_amount?: number | string | null; net_amount?: number | string | null; status?: string }>;
  paid_payout_rows: Array<{ net_amount?: number | string | null }>;
}

export interface DashboardKpis {
  period: string;
  patients_active: number;
  patients_total: number;
  inquiries_this_month: number;
  duties_scheduled: number;
  duties_completed: number;
  billings_open: number;
  collected_this_month: number;
  payout_gross: number;
  payout_net: number;
  payout_paid: number;
  payout_outstanding: number;
}

export function buildDashboardKpis(period: string, raw: DashboardRawCounts): DashboardKpis {
  const collected = sumReceiptAmounts(raw.receipt_amounts);
  const payoutGross = raw.payout_rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);
  const payoutNet = raw.payout_rows.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const payoutPaid = raw.paid_payout_rows.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  return {
    period,
    patients_active: raw.patients_active,
    patients_total: raw.patients_total,
    inquiries_this_month: raw.inquiries_this_month,
    duties_scheduled: raw.duties_scheduled,
    duties_completed: raw.duties_completed,
    billings_open: raw.billings_open,
    collected_this_month: collected,
    payout_gross: payoutGross,
    payout_net: payoutNet,
    payout_paid: payoutPaid,
    payout_outstanding: payoutOutstanding(payoutNet, payoutPaid)
  };
}

export interface PayrollPayoutRow {
  employee_id: string;
  gross_amount?: number | string | null;
  advance?: number | string | null;
  deduction?: number | string | null;
  bonus?: number | string | null;
  net_amount?: number | string | null;
  [key: string]: unknown;
}

export interface PayrollTotals {
  gross: number;
  net: number;
  advance: number;
  deduction: number;
  bonus: number;
}

export function aggregatePayrollTotals(rows: PayrollPayoutRow[]): PayrollTotals {
  return rows.reduce(
    (acc, r) => {
      acc.gross += Number(r.gross_amount || 0);
      acc.net += Number(r.net_amount || 0);
      acc.advance += Number(r.advance || 0);
      acc.deduction += Number(r.deduction || 0);
      acc.bonus += Number(r.bonus || 0);
      return acc;
    },
    { gross: 0, net: 0, advance: 0, deduction: 0, bonus: 0 }
  );
}

export function attachAttendanceToPayrollRows<T extends PayrollPayoutRow>(
  payouts: T[],
  attendance: AttendanceRollupRow[]
): Array<T & { attendance: AttendanceRollup }> {
  const attByEmp = aggregateAttendanceByEmployee(attendance);
  const empty: AttendanceRollup = { present: 0, absent: 0, late: 0, hours: 0 };
  return payouts.map((p) => ({
    ...p,
    attendance: attByEmp.get(p.employee_id) || empty
  }));
}

/** Re-export for services computing adjustment preview. */
export { computePayoutNet };

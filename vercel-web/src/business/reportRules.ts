import { monthRangeUTC } from "@/business/dateRules";
import { payoutOutstanding, computePayoutNet } from "@/business/payoutRules";
import { sumReceiptAmounts, sumServiceTotals } from "@/business/billingRules";
import {
  aggregateAttendanceByEmployee,
  type AttendanceRollup,
  type AttendanceRollupRow
} from "@/business/attendanceRules";

export { monthRangeUTC };

// ───────────────────────────────────────────────────────────────────────────
// Dashboard KPIs
// ───────────────────────────────────────────────────────────────────────────

/**
 * Raw row counts + sums sourced from `hh_*` tables. The repository layer
 * fills this in; the business layer is the *only* place that converts these
 * into KPIs the UI consumes — so the dashboard widget and the records page
 * can never drift.
 */
export interface DashboardRawCounts {
  patients_total: number;
  patients_active: number;
  employees_total: number;
  employees_active: number;
  inquiries_this_month: number;
  duties_active: number;
  duties_scheduled: number;
  duties_completed: number;
  duties_cancelled: number;
  billings_total: number;
  billings_open: number;
  billings_closed: number;
  /** Service-entry rows for the period (used for "billing total"). */
  service_rows: Array<{ total?: number | string | null; billing_id?: string | null }>;
  /** Active (non-soft-deleted) receipt rows for the period. */
  receipt_rows: Array<{ amount?: number | string | null; billing_id?: string | null }>;
  /** All payout rows for the period. */
  payout_rows: Array<{
    gross_amount?: number | string | null;
    net_amount?: number | string | null;
    advance?: number | string | null;
    deduction?: number | string | null;
    bonus?: number | string | null;
    status?: string;
  }>;
  /** Partner charge ledger (`hh_payout_charges`) in the period. */
  payout_charge_rows?: Array<{ amount?: number | string | null }>;
}

export interface DashboardKpis {
  period: string;
  range: { from: string; to: string };

  // Patients
  patients_total: number;
  patients_active: number;

  // Employees
  employees_total: number;
  employees_active: number;

  // Inquiries
  inquiries_this_month: number;

  // Duties
  duties_active: number;
  duties_scheduled: number;
  duties_completed: number;
  duties_cancelled: number;

  // Billing — "total" = sum of service-entry totals for the period;
  //          "collected" = sum of receipts;
  //          "pending" = total − collected (clamped ≥ 0).
  billings_total: number;
  billings_open: number;
  billings_closed: number;
  billing_total_amount: number;
  billing_collected_amount: number;
  billing_pending_amount: number;

  // Payouts — total = net_amount sum, paid = net for PAID rows,
  //           pending = total − paid (= outstanding).
  payout_total_amount: number;
  payout_gross_amount: number;
  payout_paid_amount: number;
  payout_pending_amount: number;
  /** Partner diary charge ledger in the period (complements `hh_payouts`). */
  partner_charge_ledger: number;

  // Profit/Loss — collected minus payout-paid for the period.
  profit_loss: number;
}

/** Build the dashboard KPI bundle from raw counts. Pure function. */
export function buildDashboardKpis(
  period: string,
  range: { from: string; to: string },
  raw: DashboardRawCounts
): DashboardKpis {
  const billingTotal = sumServiceTotals(raw.service_rows);
  const collected = sumReceiptAmounts(raw.receipt_rows);
  const pendingBilling = Math.max(0, billingTotal - collected);

  const payoutNet = raw.payout_rows.reduce(
    (s, r) => s + Number(r.net_amount || 0),
    0
  );
  const payoutGross = raw.payout_rows.reduce(
    (s, r) => s + Number(r.gross_amount || 0),
    0
  );
  const payoutPaid = raw.payout_rows
    .filter((r) => String(r.status || "").toUpperCase() === "PAID")
    .reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const partnerChargeLedger = sumReceiptAmounts(raw.payout_charge_rows || []);
  const payoutPending = payoutOutstanding(payoutNet, payoutPaid) + partnerChargeLedger;

  // Profit/loss for the window — collected receipts minus payouts already paid.
  // Don't subtract payable-but-unpaid payouts; that hides a liability and
  // makes the dashboard inconsistent with finance reports.
  const profitLoss = round2(collected - payoutPaid);

  return {
    period,
    range,
    patients_total: raw.patients_total,
    patients_active: raw.patients_active,
    employees_total: raw.employees_total,
    employees_active: raw.employees_active,
    inquiries_this_month: raw.inquiries_this_month,
    duties_active: raw.duties_active,
    duties_scheduled: raw.duties_scheduled,
    duties_completed: raw.duties_completed,
    duties_cancelled: raw.duties_cancelled,
    billings_total: raw.billings_total,
    billings_open: raw.billings_open,
    billings_closed: raw.billings_closed,
    billing_total_amount: round2(billingTotal),
    billing_collected_amount: round2(collected),
    billing_pending_amount: round2(pendingBilling),
    payout_total_amount: round2(payoutNet),
    payout_gross_amount: round2(payoutGross),
    payout_paid_amount: round2(payoutPaid),
    payout_pending_amount: round2(payoutPending),
    partner_charge_ledger: round2(partnerChargeLedger),
    profit_loss: profitLoss
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Billing totals (filtered) for the reports page
// ───────────────────────────────────────────────────────────────────────────

export interface BillingTotalsReport {
  period: string;
  range: { from: string; to: string };
  billings_count: number;
  service_total: number;
  collected: number;
  pending: number;
  byStatus: Record<string, { count: number }>;
}

export function buildBillingTotals(
  period: string,
  range: { from: string; to: string },
  args: {
    billings: Array<{ id?: string | null; status?: string | null }>;
    services: Array<{ total?: number | string | null; billing_id?: string | null }>;
    receipts: Array<{ amount?: number | string | null; billing_id?: string | null }>;
  }
): BillingTotalsReport {
  const serviceTotal = sumServiceTotals(args.services);
  const collected = sumReceiptAmounts(args.receipts);
  const byStatus: Record<string, { count: number }> = {};
  for (const b of args.billings) {
    const key = String(b.status || "Unknown");
    byStatus[key] = byStatus[key] || { count: 0 };
    byStatus[key].count += 1;
  }
  return {
    period,
    range,
    billings_count: args.billings.length,
    service_total: round2(serviceTotal),
    collected: round2(collected),
    pending: round2(Math.max(0, serviceTotal - collected)),
    byStatus
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Payout totals (filtered)
// ───────────────────────────────────────────────────────────────────────────

export interface PayoutTotalsReport {
  period: string;
  range: { from: string; to: string };
  rows_count: number;
  gross: number;
  net: number;
  paid: number;
  pending: number;
  advance: number;
  deduction: number;
  bonus: number;
}

export function buildPayoutTotals(
  period: string,
  range: { from: string; to: string },
  rows: Array<{
    gross_amount?: number | string | null;
    net_amount?: number | string | null;
    advance?: number | string | null;
    deduction?: number | string | null;
    bonus?: number | string | null;
    status?: string;
  }>
): PayoutTotalsReport {
  const gross = rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);
  const net = rows.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const advance = rows.reduce((s, r) => s + Number(r.advance || 0), 0);
  const deduction = rows.reduce((s, r) => s + Number(r.deduction || 0), 0);
  const bonus = rows.reduce((s, r) => s + Number(r.bonus || 0), 0);
  const paid = rows
    .filter((r) => String(r.status || "").toUpperCase() === "PAID")
    .reduce((s, r) => s + Number(r.net_amount || 0), 0);
  return {
    period,
    range,
    rows_count: rows.length,
    gross: round2(gross),
    net: round2(net),
    paid: round2(paid),
    pending: round2(payoutOutstanding(net, paid)),
    advance: round2(advance),
    deduction: round2(deduction),
    bonus: round2(bonus)
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Profit / Loss (window)
// ───────────────────────────────────────────────────────────────────────────

export interface ProfitLossReport {
  period: string;
  range: { from: string; to: string };
  revenue: number;
  payouts_paid: number;
  payouts_pending: number;
  /** Sum of `hh_payout_charges` in window (duty diary + legacy ledger). */
  partner_charge_ledger: number;
  net_profit: number;
  net_profit_after_pending_payouts: number;
}

export function buildProfitLoss(
  period: string,
  range: { from: string; to: string },
  args: {
    receipts: Array<{ amount?: number | string | null }>;
    payouts: Array<{ net_amount?: number | string | null; status?: string }>;
    payout_charges?: Array<{ amount?: number | string | null }>;
  }
): ProfitLossReport {
  const revenue = sumReceiptAmounts(args.receipts);
  const payoutPaid = args.payouts
    .filter((r) => String(r.status || "").toUpperCase() === "PAID")
    .reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const payoutAll = args.payouts.reduce(
    (s, r) => s + Number(r.net_amount || 0),
    0
  );
  const partnerChargeLedger = sumReceiptAmounts(args.payout_charges || []);
  const payoutPending = payoutOutstanding(payoutAll, payoutPaid) + partnerChargeLedger;

  return {
    period,
    range,
    revenue: round2(revenue),
    payouts_paid: round2(payoutPaid),
    payouts_pending: round2(payoutPending),
    partner_charge_ledger: round2(partnerChargeLedger),
    net_profit: round2(revenue - payoutPaid),
    net_profit_after_pending_payouts: round2(revenue - payoutAll - partnerChargeLedger)
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Payroll (per-employee)
// ───────────────────────────────────────────────────────────────────────────

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

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Re-export for services computing adjustment preview. */
export { computePayoutNet };

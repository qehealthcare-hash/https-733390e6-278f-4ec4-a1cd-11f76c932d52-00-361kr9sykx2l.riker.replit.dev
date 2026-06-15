import { monthRangeUTC } from "@/business/dateRules";
import { payoutOutstanding, computePayoutNet } from "@/business/payoutRules";
import { sumReceiptAmounts, sumServiceTotals } from "@/business/billingRules";
import { clampMoneyNonNegative, roundMoney } from "@/utils/money";
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
    employee_id?: string | null;
    gross_amount?: number | string | null;
    net_amount?: number | string | null;
    advance?: number | string | null;
    deduction?: number | string | null;
    bonus?: number | string | null;
    status?: string;
  }>;
  /** Partner charge ledger (`hh_payout_charges`) in the period. */
  payout_charge_rows?: Array<{
    amount?: number | string | null;
    partner_id?: string | null;
    partner?: string | null;
  }>;
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

  // Payouts — total = net_amount sum, paid = net for PAID rows.
  // Pending = payout-row outstanding + charge rows for employees that do not
  // yet have a payout row. This avoids counting the same duty charge twice
  // after `hh_recompute_payout` has already folded it into hh_payouts.
  payout_total_amount: number;
  payout_gross_amount: number;
  payout_paid_amount: number;
  payout_pending_amount: number;
  /** Partner diary charge ledger in the period (complements `hh_payouts`). */
  partner_charge_ledger: number;

  // Profit/Loss — collected minus payout-paid for the period.
  profit_loss: number;
  /**
   * M3-H4: conservative variant of `profit_loss` that ALSO subtracts
   * payouts that are owed but not yet disbursed AND partner-diary
   * charges. Mirrors `buildProfitLoss().net_profit_after_pending_payouts`
   * so the dashboard widget and the P/L report agree to the rupee.
   *
   * Formula: collected − payouts (gross net amount, regardless of
   * status) − unrepresented partner-charge ledger.
   *
   * Why both numbers ship on the dashboard:
   *   - `profit_loss` is the cash-basis snapshot operators see at end
   *     of month for cash-on-hand decisions.
   *   - `profit_loss_after_pending` is the accrual-basis figure owners
   *     read for true operating profit. Surfacing both stops the
   *     ambiguity that the old single-card layout invited.
   */
  profit_loss_after_pending: number;
}

function normalizedId(value: unknown): string {
  return String(value || "").trim();
}

function payoutChargeEmployeeId(row: {
  partner_id?: string | null;
  partner?: string | null;
}): string {
  return normalizedId(row.partner_id) || normalizedId(row.partner);
}

function sumUnrepresentedPayoutCharges(
  charges: Array<{
    amount?: number | string | null;
    partner_id?: string | null;
    partner?: string | null;
  }>,
  payouts: Array<{ employee_id?: string | null }>
): number {
  const representedEmployees = new Set(
    payouts.map((p) => normalizedId(p.employee_id)).filter(Boolean)
  );
  return charges.reduce((sum, row) => {
    const employeeId = payoutChargeEmployeeId(row);
    if (employeeId && representedEmployees.has(employeeId)) return sum;
    return sum + Number(row.amount || 0);
  }, 0);
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
  const unrepresentedPartnerChargeLedger = sumUnrepresentedPayoutCharges(
    raw.payout_charge_rows || [],
    raw.payout_rows
  );
  const payoutPending =
    payoutOutstanding(payoutNet, payoutPaid) + unrepresentedPartnerChargeLedger;

  // Profit/loss for the window — collected receipts minus payouts already paid.
  // Don't subtract payable-but-unpaid payouts; that hides a liability and
  // makes the dashboard inconsistent with finance reports.
  const profitLoss = roundMoney(collected - payoutPaid);

  // M3-H4: conservative companion to `profitLoss`. Mirrors the formula in
  // `buildProfitLoss().net_profit_after_pending_payouts` exactly:
  //   collected − payouts (net, regardless of status) − partner-charge ledger.
  // Surfacing this alongside `profit_loss` ends the long-standing UX trap
  // where owners read "Profit / Loss" as accrual profit when it was only
  // cash-basis (paid payouts only).
  const profitLossAfterPending = roundMoney(
    collected - payoutNet - unrepresentedPartnerChargeLedger
  );

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
    billing_total_amount: roundMoney(billingTotal),
    billing_collected_amount: roundMoney(collected),
    billing_pending_amount: roundMoney(pendingBilling),
    payout_total_amount: roundMoney(payoutNet),
    payout_gross_amount: roundMoney(payoutGross),
    payout_paid_amount: roundMoney(payoutPaid),
    payout_pending_amount: roundMoney(payoutPending),
    partner_charge_ledger: roundMoney(partnerChargeLedger),
    profit_loss: profitLoss,
    profit_loss_after_pending: profitLossAfterPending
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
  const activeBillingIds = new Set<string>();
  for (const s of args.services) {
    const id = String(s.billing_id || "");
    if (id) activeBillingIds.add(id);
  }
  for (const r of args.receipts) {
    const id = String(r.billing_id || "");
    if (id) activeBillingIds.add(id);
  }
  const statusById = new Map(
    args.billings.map((b) => [String(b.id || ""), String(b.status || "Unknown")])
  );
  const byStatus: Record<string, { count: number }> = {};
  for (const id of activeBillingIds) {
    const key = statusById.get(id) || "Unknown";
    byStatus[key] = byStatus[key] || { count: 0 };
    byStatus[key].count += 1;
  }
  return {
    period,
    range,
    billings_count: activeBillingIds.size,
    service_total: roundMoney(serviceTotal),
    collected: roundMoney(collected),
    pending: clampMoneyNonNegative(serviceTotal - collected),
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
  /** Full partner diary charge ledger in the period (display/audit only). */
  partner_charge_ledger: number;
  advance: number;
  deduction: number;
  bonus: number;
}

export function buildPayoutTotals(
  period: string,
  range: { from: string; to: string },
  rows: Array<{
    employee_id?: string | null;
    gross_amount?: number | string | null;
    net_amount?: number | string | null;
    advance?: number | string | null;
    deduction?: number | string | null;
    bonus?: number | string | null;
    status?: string;
  }>,
  payoutChargeRows: Array<{
    amount?: number | string | null;
    partner_id?: string | null;
    partner?: string | null;
  }> = []
): PayoutTotalsReport {
  const gross = rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);
  const net = rows.reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const advance = rows.reduce((s, r) => s + Number(r.advance || 0), 0);
  const deduction = rows.reduce((s, r) => s + Number(r.deduction || 0), 0);
  const bonus = rows.reduce((s, r) => s + Number(r.bonus || 0), 0);
  const paid = rows
    .filter((r) => String(r.status || "").toUpperCase() === "PAID")
    .reduce((s, r) => s + Number(r.net_amount || 0), 0);
  const partnerChargeLedger = sumReceiptAmounts(payoutChargeRows);
  const unrepresentedPartnerChargeLedger = sumUnrepresentedPayoutCharges(
    payoutChargeRows,
    rows
  );
  return {
    period,
    range,
    rows_count: rows.length,
    gross: roundMoney(gross),
    net: roundMoney(net),
    paid: roundMoney(paid),
    pending: roundMoney(payoutOutstanding(net, paid) + unrepresentedPartnerChargeLedger),
    partner_charge_ledger: roundMoney(partnerChargeLedger),
    advance: roundMoney(advance),
    deduction: roundMoney(deduction),
    bonus: roundMoney(bonus)
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
    payouts: Array<{
      employee_id?: string | null;
      net_amount?: number | string | null;
      status?: string;
    }>;
    payout_charges?: Array<{
      amount?: number | string | null;
      partner_id?: string | null;
      partner?: string | null;
    }>;
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
  const unrepresentedPartnerChargeLedger = sumUnrepresentedPayoutCharges(
    args.payout_charges || [],
    args.payouts
  );
  const payoutPending =
    payoutOutstanding(payoutAll, payoutPaid) + unrepresentedPartnerChargeLedger;

  return {
    period,
    range,
    revenue: roundMoney(revenue),
    payouts_paid: roundMoney(payoutPaid),
    payouts_pending: roundMoney(payoutPending),
    partner_charge_ledger: roundMoney(partnerChargeLedger),
    net_profit: roundMoney(revenue - payoutPaid),
    net_profit_after_pending_payouts: roundMoney(
      revenue - payoutAll - unrepresentedPartnerChargeLedger
    )
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

/** Payroll attendance columns from the duty-calendar ledger (not hh_attendance). */
export function attachLedgerAttendanceToPayrollRows<T extends PayrollPayoutRow>(
  payouts: T[],
  ledgers: Map<string, { present_days: number }>
): Array<T & { attendance: AttendanceRollup }> {
  const empty: AttendanceRollup = { present: 0, absent: 0, late: 0, hours: 0 };
  return payouts.map((p) => {
    const ledger = ledgers.get(p.employee_id);
    return {
      ...p,
      attendance: ledger
        ? { present: ledger.present_days, absent: 0, late: 0, hours: 0 }
        : empty
    };
  });
}

/** Business date for receipts: `date` when YYYY-MM-DD, else `created_at` day. */
export function receiptBusinessYmd(row: {
  date?: string | null;
  created_at?: string | null;
}): string {
  const d = String(row.date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const created = String(row.created_at || "");
  return created ? created.slice(0, 10) : "";
}

export function receiptInYmdRange(
  row: { date?: string | null; created_at?: string | null },
  fromYMD: string,
  toYMD: string,
  fromISO: string,
  toISO: string
): boolean {
  const ymd = receiptBusinessYmd(row);
  if (ymd) return ymd >= fromYMD && ymd < toYMD;
  const created = String(row.created_at || "");
  return created >= fromISO && created < toISO;
}

/** Re-export for services computing adjustment preview. */
export { computePayoutNet };

// ───────────────────────────────────────────────────────────────────────────
// Per-tab summary builders (Phase 12 — server-side aggregation)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Canonical inquiry status buckets surfaced on the Reports → Inquiries tab.
 * Mirrors the keys the legacy client-side aggregator used so the UI doesn't
 * have to special-case any new bucket name from the server.
 */
export const INQUIRY_STATUS_BUCKETS = [
  "New",
  "Contacted",
  "FollowUp",
  "Negotiating",
  "Converted",
  "Closed",
  "Lost"
] as const;

export const INQUIRY_POTENTIAL_BUCKETS = ["HOT", "WARM", "COLD"] as const;

export interface InquirySummaryGroupRow {
  status?: string | null;
  potential?: string | null;
  source?: string | null;
  followup_date?: string | null;
}

export interface InquirySummary {
  period: string;
  range: { from: string; to: string };
  total: number;
  followup_due: number;
  by_status: Record<string, number>;
  by_potential: Record<string, number>;
  by_source: Record<string, number>;
  /** True when the defensive group-by slice (capped at 1000) was full. */
  grouping_truncated: boolean;
}

/**
 * Build an inquiry summary from:
 *   - `total`: SQL `count='exact'` over the entire window (always accurate)
 *   - `groupRows`: a single defensive fetch capped at REPORT_ROW_CEILING used
 *     to bucket free-form columns (`source`, `potential`).
 *   - `byStatusOverrides`: SQL counts for canonical status buckets so the
 *     enum'd values stay exact even when the group-by slice is truncated.
 */
export function buildInquirySummary(
  period: string,
  range: { from: string; to: string },
  args: {
    total: number;
    followup_due: number;
    groupRows: InquirySummaryGroupRow[];
    byStatusOverrides?: Partial<Record<string, number>>;
    groupingTruncated: boolean;
  }
): InquirySummary {
  const by_status: Record<string, number> = {};
  const by_potential: Record<string, number> = {};
  const by_source: Record<string, number> = {};
  for (const k of INQUIRY_STATUS_BUCKETS) by_status[k] = 0;
  for (const k of INQUIRY_POTENTIAL_BUCKETS) by_potential[k] = 0;
  for (const r of args.groupRows) {
    const s = String(r.status || "").trim();
    if (s) by_status[s] = (by_status[s] ?? 0) + 1;
    const p = String(r.potential || "").trim().toUpperCase();
    if (p) by_potential[p] = (by_potential[p] ?? 0) + 1;
    const src = String(r.source || "").trim() || "Unknown";
    by_source[src] = (by_source[src] ?? 0) + 1;
  }
  // Prefer SQL-derived bucket counts so enum buckets stay accurate even when
  // the group-by slice was truncated at REPORT_ROW_CEILING.
  if (args.byStatusOverrides) {
    for (const [k, v] of Object.entries(args.byStatusOverrides)) {
      if (typeof v === "number") by_status[k] = v;
    }
  }
  return {
    period,
    range,
    total: args.total,
    followup_due: args.followup_due,
    by_status,
    by_potential,
    by_source,
    grouping_truncated: args.groupingTruncated
  };
}

export interface PatientSummaryGroupRow {
  status?: string | null;
  area?: string | null;
}

export interface PatientSummary {
  period: string;
  range: { from: string; to: string };
  total: number;
  by_status: Record<string, number>;
  by_area: Record<string, number>;
  grouping_truncated: boolean;
}

export function buildPatientSummary(
  period: string,
  range: { from: string; to: string },
  args: {
    total: number;
    groupRows: PatientSummaryGroupRow[];
    byStatusOverrides?: Partial<Record<string, number>>;
    groupingTruncated: boolean;
  }
): PatientSummary {
  const by_status: Record<string, number> = {};
  const by_area: Record<string, number> = {};
  for (const r of args.groupRows) {
    const s = String(r.status || "").trim() || "Unknown";
    by_status[s] = (by_status[s] ?? 0) + 1;
    const area = String(r.area || "").trim() || "Unknown";
    by_area[area] = (by_area[area] ?? 0) + 1;
  }
  if (args.byStatusOverrides) {
    for (const [k, v] of Object.entries(args.byStatusOverrides)) {
      if (typeof v === "number") by_status[k] = v;
    }
  }
  return {
    period,
    range,
    total: args.total,
    by_status,
    by_area,
    grouping_truncated: args.groupingTruncated
  };
}

export const ATTENDANCE_STATUS_BUCKETS = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "HALF_DAY",
  "LEAVE",
  "HOLIDAY"
] as const;

export interface AttendanceSummaryRow {
  employee_id?: string | null;
  status?: string | null;
  shift_type?: string | null;
  hours?: number | string | null;
}

export interface AttendanceSummaryByEmployee {
  employee_id: string;
  present: number;
  absent: number;
  late: number;
  half_day: number;
  leave: number;
  holiday: number;
  hours: number;
}

export interface AttendanceSummary {
  period: string;
  range: { from: string; to: string };
  total: number;
  by_status: Record<string, number>;
  by_shift: Record<string, number>;
  by_employee: AttendanceSummaryByEmployee[];
}

function bumpEmployee(
  map: Map<string, AttendanceSummaryByEmployee>,
  empId: string
): AttendanceSummaryByEmployee {
  let row = map.get(empId);
  if (!row) {
    row = {
      employee_id: empId,
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
      leave: 0,
      holiday: 0,
      hours: 0
    };
    map.set(empId, row);
  }
  return row;
}

export function buildAttendanceSummary(
  period: string,
  range: { from: string; to: string },
  rows: AttendanceSummaryRow[]
): AttendanceSummary {
  const by_status: Record<string, number> = {};
  const by_shift: Record<string, number> = {};
  const empMap = new Map<string, AttendanceSummaryByEmployee>();
  for (const k of ATTENDANCE_STATUS_BUCKETS) by_status[k] = 0;
  for (const r of rows) {
    const status = String(r.status || "").toUpperCase();
    if (status) by_status[status] = (by_status[status] ?? 0) + 1;
    const shift = String(r.shift_type || "").trim() || "Unknown";
    by_shift[shift] = (by_shift[shift] ?? 0) + 1;
    const empId = String(r.employee_id || "").trim() || "—";
    const emp = bumpEmployee(empMap, empId);
    emp.hours += Number(r.hours || 0);
    if (status === "PRESENT") emp.present += 1;
    else if (status === "ABSENT") emp.absent += 1;
    else if (status === "LATE") emp.late += 1;
    else if (status === "HALF_DAY") emp.half_day += 1;
    else if (status === "LEAVE") emp.leave += 1;
    else if (status === "HOLIDAY") emp.holiday += 1;
  }
  return {
    period,
    range,
    total: rows.length,
    by_status,
    by_shift,
    by_employee: Array.from(empMap.values()).sort((a, b) =>
      a.employee_id.localeCompare(b.employee_id)
    )
  };
}

/**
 * Attendance summary derived strictly from materialized duty-calendar payout
 * charges (present_days = count of duty-day ledger rows per employee).
 */
export function buildAttendanceSummaryFromLedger(
  period: string,
  range: { from: string; to: string },
  ledgers: Map<string, { employee_id: string; present_days: number }>
): AttendanceSummary {
  const by_employee: AttendanceSummaryByEmployee[] = Array.from(ledgers.values())
    .map((l) => ({
      employee_id: l.employee_id,
      present: l.present_days,
      absent: 0,
      late: 0,
      half_day: 0,
      leave: 0,
      holiday: 0,
      hours: 0
    }))
    .sort((a, b) => a.employee_id.localeCompare(b.employee_id));
  const total = by_employee.reduce((s, e) => s + e.present, 0);
  const by_status: Record<string, number> = {};
  for (const k of ATTENDANCE_STATUS_BUCKETS) by_status[k] = 0;
  by_status.PRESENT = total;
  return {
    period,
    range,
    total,
    by_status,
    by_shift: {},
    by_employee
  };
}

export interface BillingSummaryRow {
  billing_id: string;
  status: string | null;
  patient_id: string | null;
  patient_name?: string;
  patient_phone?: string;
  sec_dep: number;
  totals: { services: number; receipts: number; outstanding: number };
  paid_status: string;
  created_at?: string | null;
}

export interface BillingSummary extends BillingTotalsReport {
  total_received: number;
  outstanding: number;
}

/**
 * Extend `buildBillingTotals` with `total_received` and `outstanding` aliases
 * the Billing detail tab CSV / table consume.
 */
export function buildBillingSummary(
  period: string,
  range: { from: string; to: string },
  args: {
    billings: Array<{ id?: string | null; status?: string | null }>;
    services: Array<{ total?: number | string | null; billing_id?: string | null }>;
    receipts: Array<{ amount?: number | string | null; billing_id?: string | null }>;
  }
): BillingSummary {
  const base = buildBillingTotals(period, range, args);
  return {
    ...base,
    total_received: base.collected,
    outstanding: base.pending
  };
}

/** Canonical PayoutDetailDTO fixture for contract tests. */
export function payoutDetailFixture(overrides: Record<string, unknown> = {}) {
  return {
    payout: {
      id: "PAY2026050001",
      employee_id: "EMP001",
      period_month: "2026-05",
      status: "LOCKED",
      gross_amount: 12000,
      net_amount: 11000,
      advance: 1000,
      deduction: 0,
      bonus: 0,
      duty_count: 22,
      hours: 176,
      employee_name: "Test Employee"
    },
    duties: [],
    attendance: [],
    breakdown: [],
    paid_transactions: [{ id: "TX1", amount: 5000, tx_kind: "ADVANCE" }],
    paid_total: 5000,
    outstanding: 6000,
    employee_name: "Test Employee",
    patient_breakdown: [],
    diagnostics: {
      charge_row_count: 22,
      charge_sum: 12000,
      duty_row_count: 22,
      attendance_row_count: 22,
      warning: ""
    },
    permissions: {
      canAdjust: false,
      canLock: false,
      canReopen: true,
      canPayFinal: true,
      canPayAdvance: false
    },
    ...overrides
  };
}

/** Canonical billing/payout totals fixtures for route contract tests. */
export function billingTotalsFixture(overrides: Record<string, unknown> = {}) {
  return {
    period: "2026-05",
    range: { from: "2026-05-01T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
    billings_count: 0,
    service_total: 0,
    collected: 0,
    pending: 0,
    byStatus: {},
    ...overrides
  };
}

export function payoutTotalsFixture(overrides: Record<string, unknown> = {}) {
  return {
    period: "2026-05",
    range: { from: "2026-05-01T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
    rows_count: 0,
    gross: 0,
    net: 0,
    paid: 0,
    pending: 0,
    partner_charge_ledger: 0,
    advance: 0,
    deduction: 0,
    bonus: 0,
    ...overrides
  };
}

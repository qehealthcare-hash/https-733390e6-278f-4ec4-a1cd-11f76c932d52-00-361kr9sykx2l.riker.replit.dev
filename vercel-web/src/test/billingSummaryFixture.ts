/**
 * Canonical BillingSummaryDTO fixture for contract tests.
 * Keep in sync with `billingSummaryDtoSchema` in `@/validation/billingDto`.
 */
export function billingSummaryFixture(overrides: Record<string, unknown> = {}) {
  return {
    billing: {
      id: "B0528117702",
      patient_id: "PID1034",
      status: "Closed",
      paid_status: "PARTIAL"
    },
    services: [{ id: "S1", date: "2026-05-01", total: 6050 }],
    receipts: [{ id: "R1", billing_id: "B0528117702", amount: 5000 }],
    invoices: [
      {
        invoice: {
          id: "INV1",
          billing_id: "B0528117702",
          kind: "MONTHLY",
          amount: 6050
        },
        amount: 6050,
        received: 5000,
        outstanding: 1050,
        status: "PARTIAL"
      }
    ],
    totals: {
      services: 6050,
      billed: 6050,
      receipts: 5000,
      sec_dep: 5000,
      discount: 0,
      advance: 0,
      outstanding: 1050
    },
    period: { months: ["2026-05"] },
    patient: null,
    permissions: {
      canEdit: false,
      canReceive: true,
      canGenerateFinal: false,
      canClose: false,
      canReopen: true
    },
    ...overrides
  };
}

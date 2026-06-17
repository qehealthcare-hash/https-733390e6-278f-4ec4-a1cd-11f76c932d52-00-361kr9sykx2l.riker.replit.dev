/**
 * Billing list row fixture — mirrors production rows with refund/reversal receipts.
 * Bill B0529099390 has a −5000 receipt in live data; the list schema must accept it.
 */
export function billingListRowWithNegativeReceiptsFixture() {
  return {
    id: "B0529099390",
    patient_id: "PID1042",
    status: "Active",
    paid_status: "UNPAID",
    sec_dep: 0,
    closed_at: null,
    patient_name: "Sample Patient",
    patient_phone: "9876543210",
    totals: {
      services: 0,
      billed: 0,
      receipts: -5000,
      sec_dep: 0,
      discount: 0,
      advance: 0,
      outstanding: 0
    }
  };
}

export function billingListResponseFixture(
  overrides: { rows?: unknown[]; total?: number } = {}
) {
  return {
    rows: [billingListRowWithNegativeReceiptsFixture()],
    total: 1,
    ...overrides
  };
}

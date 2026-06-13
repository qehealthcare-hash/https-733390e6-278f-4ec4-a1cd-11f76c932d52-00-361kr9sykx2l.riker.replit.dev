import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/database/payoutRepository", () => ({
  payoutRepository: {
    pendingPayoutRpc: vi.fn(),
    listChargesByEmployeePeriod: vi.fn(),
    recomputeRpc: vi.fn()
  }
}));
vi.mock("@/database/billingRepository", () => ({
  billingRepository: {
    listBillingsByPatient: vi.fn(),
    listSvcByBillingIds: vi.fn(),
    listActiveReceiptsByBillingIds: vi.fn()
  }
}));
vi.mock("@/database/dutyRepository", () => ({
  dutyRepository: {
    list: vi.fn(),
    findById: vi.fn(),
    findPayoutChargesByDutyId: vi.fn()
  }
}));

import { payoutRepository } from "@/database/payoutRepository";
import { billingRepository } from "@/database/billingRepository";
import {
  getEmployeePayoutLedger,
  getPatientBillingLedger
} from "@/src/lib/duty-ledger";

const ok = <T>(data: T) => ({ success: true as const, data });

describe("duty-ledger — single calculation authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("employee payout = live charges (gross, count, outstanding)", async () => {
    vi.mocked(payoutRepository.pendingPayoutRpc).mockResolvedValue(
      ok({ employee_id: "E1", period_month: "2026-06", charged: 5629, paid: 0, pending: 5629, duty_count: 13 })
    );
    vi.mocked(payoutRepository.listChargesByEmployeePeriod).mockResolvedValue(
      ok(Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, amount: 433, date: `2026-06-0${(i % 9) + 1}` })))
    );

    const res = await getEmployeePayoutLedger("E1", "2026-06");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.duty_count).toBe(13);
    expect(res.data.gross).toBe(5629);
    expect(res.data.outstanding).toBe(5629);
    expect(res.data.source_row_ids).toHaveLength(13);
  });

  it("employee payout outstanding reduces when disbursement is paid", async () => {
    vi.mocked(payoutRepository.pendingPayoutRpc).mockResolvedValue(
      ok({ employee_id: "E1", period_month: "2026-05", charged: 8227, paid: 8227, pending: 0, duty_count: 19 })
    );
    vi.mocked(payoutRepository.listChargesByEmployeePeriod).mockResolvedValue(ok([{ id: "c1", amount: 8227, date: "2026-05-01" }]));

    const res = await getEmployeePayoutLedger("E1", "2026-05");
    if (!res.success) return;
    expect(res.data.outstanding).toBe(0);
  });

  it("patient billing sums only svc rows in the period", async () => {
    vi.mocked(billingRepository.listBillingsByPatient).mockResolvedValue(ok([{ id: "B1" }]));
    vi.mocked(billingRepository.listSvcByBillingIds).mockResolvedValue(
      ok([
        { id: "s1", total: 600, date: "2026-06-01" },
        { id: "s2", total: 600, date: "2026-06-02" },
        { id: "s3", total: 600, date: "2026-05-31" } // different month — excluded
      ])
    );
    vi.mocked(billingRepository.listActiveReceiptsByBillingIds).mockResolvedValue(
      ok([{ id: "r1", amount: 500, date: "2026-06-10" }])
    );

    const res = await getPatientBillingLedger("P1", "2026-06");
    if (!res.success) return;
    expect(res.data.duty_count).toBe(2);
    expect(res.data.billed).toBe(1200);
    expect(res.data.received).toBe(500);
    expect(res.data.outstanding).toBe(700);
  });

  it("patient with no bills returns a zeroed ledger", async () => {
    vi.mocked(billingRepository.listBillingsByPatient).mockResolvedValue(ok([]));
    const res = await getPatientBillingLedger("P1", "2026-06");
    if (!res.success) return;
    expect(res.data.billed).toBe(0);
    expect(res.data.duty_count).toBe(0);
  });
});

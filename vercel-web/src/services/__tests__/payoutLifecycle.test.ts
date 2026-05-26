/**
 * Service-level tests for the payout lifecycle additions:
 *
 *   - markPaid records a serial-numbered paid_transaction with proof,
 *     enforces "amount ≤ outstanding", and only flips PAID when total
 *     disbursements settle the net.
 *   - payAdvance records an ADVANCE row without flipping status.
 *   - pendingForEmployeePeriod returns charged − paid even when the
 *     payout row doesn't yet exist.
 *   - list / getById hydrate employee_name.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { payoutService } from "@/services/payoutService";
import { payoutRepository } from "@/database/payoutRepository";
import { employeeRepository } from "@/database/employeeRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { attendanceRepository } from "@/database/attendanceRepository";

vi.mock("@/database/payoutRepository");
vi.mock("@/database/employeeRepository");
vi.mock("@/database/dutyRepository");
vi.mock("@/database/attendanceRepository");
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "acct@test.com", accessToken: "tok" } };

function payoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "PAY1",
    employee_id: "EMP1",
    period_month: "2026-05",
    status: "LOCKED",
    gross_amount: 12000,
    advance: 0,
    deduction: 0,
    bonus: 0,
    net_amount: 12000,
    duty_count: 24,
    hours: 180,
    paid_at: null,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(employeeRepository.findByIds).mockResolvedValue({
    success: true,
    data: [
      { id: "EMP1", fn: "Manisha", mn: "", ln: "Asari" }
    ]
  });
  vi.mocked(dutyRepository.list).mockResolvedValue({
    success: true,
    data: { rows: [], total: 0 }
  });
  vi.mocked(attendanceRepository.listForEmployeeMonth).mockResolvedValue({
    success: true,
    data: []
  });
});

describe("payoutService.markPaid", () => {
  it("rejects amount over outstanding", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ status: "LOCKED" })
    });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: [{ amount: 5000 }]
    });

    const result = await payoutService.markPaid(
      {
        payout_id: "PAY1",
        amount: 9000,
        proof_bucket: "payout-proofs",
        proof_path: "2026-05/proof.pdf"
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("business_rule_violation");
    expect(payoutRepository.nextPaidTxSerialRpc).not.toHaveBeenCalled();
    expect(payoutRepository.insertPaidTransaction).not.toHaveBeenCalled();
  });

  it("rejects when no proof is attached", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ status: "LOCKED" })
    });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });

    const result = await payoutService.markPaid(
      { payout_id: "PAY1", amount: 1000 },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("business_rule_violation");
    expect(payoutRepository.insertPaidTransaction).not.toHaveBeenCalled();
  });

  it("rejects mark paid when payout is not LOCKED", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ status: "OPEN" })
    });
    const result = await payoutService.markPaid(
      {
        payout_id: "PAY1",
        proof_bucket: "payout-proofs",
        proof_path: "x.pdf"
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("business_rule_violation");
    expect(payoutRepository.insertPaidTransaction).not.toHaveBeenCalled();
  });

  it("allocates a serial, inserts paid_tx, and flips to PAID when settled", async () => {
    vi.mocked(payoutRepository.findById)
      .mockResolvedValueOnce({ success: true, data: payoutRow({ status: "LOCKED" }) })
      .mockResolvedValueOnce({ success: true, data: payoutRow({ status: "PAID", paid_at: "2026-05-31T00:00:00Z" }) });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.nextPaidTxSerialRpc).mockResolvedValue({
      success: true,
      data: "PTX2026000042"
    });
    vi.mocked(payoutRepository.insertPaidTransaction).mockResolvedValue({
      success: true,
      data: null
    });
    vi.mocked(payoutRepository.update).mockResolvedValue({
      success: true,
      data: null
    });

    const result = await payoutService.markPaid(
      {
        payout_id: "PAY1",
        amount: 12000,
        proof_bucket: "payout-proofs",
        proof_path: "2026-05/proof.pdf"
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(payoutRepository.insertPaidTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        serial_no: "PTX2026000042",
        payout_id: "PAY1",
        tx_kind: "FINAL",
        amount: 12000,
        period_month: "2026-05",
        employee_id: "EMP1",
        proof_bucket: "payout-proofs",
        proof_path: "2026-05/proof.pdf"
      }),
      expect.any(Object)
    );
    // First update call carries the PAID patch (status = PAID).
    const firstUpdate = vi.mocked(payoutRepository.update).mock.calls[0]?.[1] as
      | { status?: string }
      | undefined;
    expect(firstUpdate?.status).toBe("PAID");
  });

  it("on partial settle, payout stays LOCKED (no PAID flip)", async () => {
    vi.mocked(payoutRepository.findById)
      .mockResolvedValueOnce({ success: true, data: payoutRow({ status: "LOCKED" }) })
      .mockResolvedValueOnce({ success: true, data: payoutRow({ status: "LOCKED" }) });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.nextPaidTxSerialRpc).mockResolvedValue({
      success: true,
      data: "PTX2026000043"
    });
    vi.mocked(payoutRepository.insertPaidTransaction).mockResolvedValue({
      success: true,
      data: null
    });
    vi.mocked(payoutRepository.update).mockResolvedValue({
      success: true,
      data: null
    });

    const result = await payoutService.markPaid(
      {
        payout_id: "PAY1",
        amount: 4000,
        proof_bucket: "payout-proofs",
        proof_path: "2026-05/partial.pdf"
      },
      ctx
    );

    expect(result.success).toBe(true);
    const firstPatch = vi.mocked(payoutRepository.update).mock.calls[0]?.[1] as
      | { status?: string }
      | undefined;
    expect(firstPatch?.status).toBeUndefined();
  });
});

describe("payoutService.payAdvance", () => {
  it("refuses advance against a LOCKED payout", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ status: "LOCKED" })
    });

    const result = await payoutService.payAdvance(
      {
        payout_id: "PAY1",
        amount: 1000,
        proof_bucket: "payout-proofs",
        proof_path: "p.pdf"
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("business_rule_violation");
  });

  it("records advance with tx_kind = ADVANCE and does not flip status", async () => {
    vi.mocked(payoutRepository.findById)
      .mockResolvedValueOnce({ success: true, data: payoutRow({ status: "OPEN" }) })
      .mockResolvedValueOnce({ success: true, data: payoutRow({ status: "OPEN" }) });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.nextPaidTxSerialRpc).mockResolvedValue({
      success: true,
      data: "PTX2026000050"
    });
    vi.mocked(payoutRepository.insertPaidTransaction).mockResolvedValue({
      success: true,
      data: null
    });
    vi.mocked(payoutRepository.update).mockResolvedValue({
      success: true,
      data: null
    });

    const result = await payoutService.payAdvance(
      {
        payout_id: "PAY1",
        amount: 3000,
        proof_bucket: "payout-proofs",
        proof_path: "adv.pdf"
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(payoutRepository.insertPaidTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        serial_no: "PTX2026000050",
        tx_kind: "ADVANCE",
        amount: 3000
      }),
      expect.any(Object)
    );
    const firstPatch = vi.mocked(payoutRepository.update).mock.calls[0]?.[1] as
      | { status?: string }
      | undefined;
    expect(firstPatch?.status).toBeUndefined();
  });
});

describe("payoutService.pendingForEmployeePeriod", () => {
  it("returns charged/paid/pending sourced from the duty calendar RPC", async () => {
    vi.mocked(payoutRepository.pendingPayoutRpc).mockResolvedValue({
      success: true,
      data: {
        employee_id: "EMP1",
        period_month: "2026-05",
        charged: 12000,
        paid: 3000,
        pending: 9000,
        duty_count: 24
      }
    });
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: null
    });
    vi.mocked(payoutRepository.listPaidTransactionsByEmployeePeriod).mockResolvedValue({
      success: true,
      data: [{ id: "PT1", amount: 3000 }]
    });

    const result = await payoutService.pendingForEmployeePeriod(
      { employee_id: "EMP1", period: "2026-05" },
      ctx
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(result.data.charged).toBe(12000);
    expect(result.data.paid).toBe(3000);
    expect(result.data.pending).toBe(9000);
    expect(result.data.employee_name).toBe("Manisha Asari");
    expect(result.data.payout).toBeNull();
    expect(result.data.paid_transactions).toHaveLength(1);
  });
});

describe("payoutService.list", () => {
  it("hydrates employee_name from a single batch lookup", async () => {
    vi.mocked(payoutRepository.list).mockResolvedValue({
      success: true,
      data: {
        rows: [
          payoutRow({ id: "PAY1", employee_id: "EMP1" }),
          payoutRow({ id: "PAY2", employee_id: "EMP2" })
        ],
        total: 2
      }
    });
    vi.mocked(employeeRepository.findByIds).mockResolvedValue({
      success: true,
      data: [
        { id: "EMP1", fn: "Manisha", ln: "Asari" },
        { id: "EMP2", fn: "Rakesh", ln: "Kumar" }
      ]
    });

    const result = await payoutService.list({}, ctx);
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(employeeRepository.findByIds).toHaveBeenCalledTimes(1);
    expect(result.data.rows[0].employee_name).toBe("Manisha Asari");
    expect(result.data.rows[1].employee_name).toBe("Rakesh Kumar");
  });
});

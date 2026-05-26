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
import { patientRepository } from "@/database/patientRepository";
import { dutyDiaryService } from "@/services/dutyDiaryService";

vi.mock("@/database/payoutRepository");
vi.mock("@/database/employeeRepository");
vi.mock("@/database/dutyRepository");
vi.mock("@/database/attendanceRepository");
vi.mock("@/database/patientRepository");
vi.mock("@/services/dutyDiaryService", () => ({
  dutyDiaryService: {
    rematerializeForEmployeePeriod: vi.fn().mockResolvedValue({
      success: true,
      data: {
        period: "2026-05",
        employee_id: "EMP1",
        duties_scanned: 0,
        duties_materialized: 0,
        duties_skipped: 0,
        failures: []
      }
    }),
    materializeDuty: vi.fn().mockResolvedValue({ success: true, data: null })
  }
}));
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
  vi.mocked(patientRepository.findByIds).mockResolvedValue({
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
    expect(result.code).toBe("validation_error");
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

describe("payoutService.pendingEmployeesForPeriod", () => {
  it("rejects bad period format with validation error", async () => {
    const result = await payoutService.pendingEmployeesForPeriod(
      { period: "not-a-month" },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("validation_error");
  });

  it("falls back to direct charge/paid table queries when the RPC is unavailable", async () => {
    vi.mocked(payoutRepository.pendingEmployeesForPeriodRpc).mockResolvedValue({
      success: false,
      error: "function public.hh_employees_pending_for_period(text) does not exist",
      code: "database_error"
    });
    vi.mocked(payoutRepository.listAllChargesForPeriod).mockResolvedValue({
      success: true,
      data: [
        { duty_id: "D1", partner_id: "EMP1", amount: 500 },
        { duty_id: "D2", partner_id: "EMP1", amount: 500 },
        // Same duty counted once even if charge has multiple lines.
        { duty_id: "D2", partner_id: "EMP1", amount: 100 },
        { duty_id: "D3", partner: "EMP2", amount: 1200 }
      ]
    });
    vi.mocked(payoutRepository.listAllPaidTransactionsForPeriod).mockResolvedValue({
      success: true,
      data: [{ employee_id: "EMP1", amount: 400 }]
    });
    vi.mocked(payoutRepository.listByPeriod).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(employeeRepository.findByIds).mockResolvedValue({
      success: true,
      data: [
        { id: "EMP1", fn: "Manisha", ln: "Asari" },
        { id: "EMP2", fn: "Rakesh", ln: "Kumar" }
      ]
    });

    const result = await payoutService.pendingEmployeesForPeriod(
      { period: "2026-05" },
      ctx
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(result.data.source).toBe("fallback");
    // EMP1: charged 1100, paid 400 → pending 700, duty_count 2 distinct duty_ids
    const byId = Object.fromEntries(
      result.data.rows.map((r) => [r.employee_id, r])
    );
    expect(byId.EMP1.pending).toBe(700);
    expect(byId.EMP1.duty_count).toBe(2);
    expect(byId.EMP1.employee_name).toBe("Manisha Asari");
    // EMP2: charged 1200, paid 0 → pending 1200
    expect(byId.EMP2.pending).toBe(1200);
    expect(byId.EMP2.employee_name).toBe("Rakesh Kumar");
    expect(result.data.total_pending).toBe(1900);
    // Highest pending first.
    expect(result.data.rows[0].employee_id).toBe("EMP2");
  });

  it("excludes employees whose pending settles within rounding noise", async () => {
    vi.mocked(payoutRepository.pendingEmployeesForPeriodRpc).mockResolvedValue({
      success: false,
      error: "RPC missing",
      code: "database_error"
    });
    vi.mocked(payoutRepository.listAllChargesForPeriod).mockResolvedValue({
      success: true,
      data: [{ duty_id: "D1", partner_id: "EMP1", amount: 1000 }]
    });
    vi.mocked(payoutRepository.listAllPaidTransactionsForPeriod).mockResolvedValue({
      success: true,
      data: [{ employee_id: "EMP1", amount: 1000 }]
    });
    vi.mocked(payoutRepository.listByPeriod).mockResolvedValue({ success: true, data: [] });
    vi.mocked(employeeRepository.findByIds).mockResolvedValue({ success: true, data: [] });

    const result = await payoutService.pendingEmployeesForPeriod(
      { period: "2026-05" },
      ctx
    );
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(result.data.rows).toHaveLength(0);
    expect(result.data.total_pending).toBe(0);
  });

  it("aggregates pending rows with employee_name and links existing payout row", async () => {
    vi.mocked(payoutRepository.pendingEmployeesForPeriodRpc).mockResolvedValue({
      success: true,
      data: [
        {
          employee_id: "EMP1",
          charged: 12000,
          paid: 4000,
          pending: 8000,
          duty_count: 24
        },
        {
          employee_id: "EMP2",
          charged: 6500,
          paid: 0,
          pending: 6500,
          duty_count: 13
        }
      ]
    });
    vi.mocked(payoutRepository.listByPeriod).mockResolvedValue({
      success: true,
      data: [
        payoutRow({ id: "PAY1", employee_id: "EMP1", status: "LOCKED" })
        // EMP2 has no payout row yet, simulating "needs Ensure"
      ]
    });
    vi.mocked(employeeRepository.findByIds).mockResolvedValue({
      success: true,
      data: [
        { id: "EMP1", fn: "Manisha", ln: "Asari" },
        { id: "EMP2", fn: "Rakesh", ln: "Kumar" }
      ]
    });

    const result = await payoutService.pendingEmployeesForPeriod(
      { period: "2026-05" },
      ctx
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(result.data.period).toBe("2026-05");
    expect(result.data.total_pending).toBe(14500);
    expect(result.data.rows).toHaveLength(2);

    const byId = Object.fromEntries(
      result.data.rows.map((r) => [r.employee_id, r])
    );
    expect(byId.EMP1.employee_name).toBe("Manisha Asari");
    expect(byId.EMP1.payout_id).toBe("PAY1");
    expect(byId.EMP1.payout_status).toBe("LOCKED");
    expect(byId.EMP2.payout_id).toBeNull();
    expect(byId.EMP2.payout_status).toBeNull();
    expect(byId.EMP2.pending).toBe(6500);
  });
});

describe("payoutService.ensure re-materializes duties before recomputing", () => {
  it("calls dutyDiaryService.rematerializeForEmployeePeriod for the employee×period", async () => {
    vi.mocked(payoutRepository.recomputeRpc).mockResolvedValue({
      success: true,
      data: { payout_id: "PAY1", duties: 1, hours: 8 }
    });
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", gross_amount: 1200 })
    });

    const result = await payoutService.ensure(
      { employee_id: "EMP1", period_month: "2026-05" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(
      dutyDiaryService.rematerializeForEmployeePeriod
    ).toHaveBeenCalledWith("EMP1", "2026-05", expect.any(Object));
    // Recompute RPC is called AFTER materialization so latest charges flow in.
    expect(payoutRepository.recomputeRpc).toHaveBeenCalledAfter(
      vi.mocked(dutyDiaryService.rematerializeForEmployeePeriod) as never
    );
  });

  it("does not block recompute when rematerialize reports failures", async () => {
    vi.mocked(dutyDiaryService.rematerializeForEmployeePeriod).mockResolvedValueOnce({
      success: false,
      error: "boom",
      code: "internal_error"
    });
    vi.mocked(payoutRepository.recomputeRpc).mockResolvedValue({
      success: true,
      data: { payout_id: "PAY1", duties: 1, hours: 8 }
    });
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", gross_amount: 1200 })
    });

    const result = await payoutService.ensure(
      { employee_id: "EMP1", period_month: "2026-05" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(payoutRepository.recomputeRpc).toHaveBeenCalledWith(
      "EMP1",
      "2026-05",
      expect.any(Object)
    );
  });
});

describe("payoutService.getById diagnostics", () => {
  it("flags zero-rate charge rows as the root cause when gross is ₹0 but duties exist", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", gross_amount: 0 })
    });
    vi.mocked(dutyRepository.list).mockResolvedValue({
      success: true,
      data: {
        rows: [
          {
            id: "DUTY1",
            employee_id: "EMP1",
            patient_id: "PAT1",
            start_at: "2026-05-01T00:00:00Z",
            end_at: "2026-05-31T23:59:59Z",
            status: "IN_PROGRESS",
            shift_type: "DAY"
          }
        ],
        total: 1
      }
    });
    vi.mocked(attendanceRepository.listForEmployeeMonth).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listChargesByEmployeePeriod).mockResolvedValue({
      success: true,
      data: [
        { id: "C1", svc_key: "SVC1", date: "2026-05-01", amount: 0 },
        { id: "C2", svc_key: "SVC1", date: "2026-05-02", amount: 0 }
      ]
    });
    vi.mocked(dutyRepository.findZeroPayoutRateForEmployeePeriod).mockResolvedValue({
      success: true,
      data: []
    });

    const result = await payoutService.getById("PAY1", ctx);
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    const d = result.data.diagnostics;
    expect(d.charge_row_count).toBe(2);
    expect(d.charge_sum).toBe(0);
    expect(d.charge_zero_rate_rows).toBe(2);
    expect(d.duty_row_count).toBe(1);
    expect(d.warning).toMatch(/every row has amount ₹0/i);
  });

  it("flags missing charges when duties exist but materialization never ran", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", gross_amount: 0 })
    });
    vi.mocked(dutyRepository.list).mockResolvedValue({
      success: true,
      data: {
        rows: [
          {
            id: "DUTY1",
            employee_id: "EMP1",
            patient_id: "PAT1",
            start_at: "2026-05-01T00:00:00Z",
            end_at: "2026-05-31T23:59:59Z",
            status: "IN_PROGRESS"
          }
        ],
        total: 1
      }
    });
    vi.mocked(attendanceRepository.listForEmployeeMonth).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listChargesByEmployeePeriod).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(dutyRepository.findZeroPayoutRateForEmployeePeriod).mockResolvedValue({
      success: true,
      data: []
    });

    const result = await payoutService.getById("PAY1", ctx);
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(result.data.diagnostics.warning).toMatch(/no payout charges have been materialized/i);
  });

  it("lists duties_needing_rate when payout_per_day is 0 on the source duties", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", gross_amount: 0 })
    });
    vi.mocked(dutyRepository.list).mockResolvedValue({
      success: true,
      data: { rows: [], total: 0 }
    });
    vi.mocked(attendanceRepository.listForEmployeeMonth).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listChargesByEmployeePeriod).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(dutyRepository.findZeroPayoutRateForEmployeePeriod).mockResolvedValue({
      success: true,
      data: [
        {
          id: "DUTY1",
          patient_id: "PAT1",
          service_name: "Care Taker Services",
          start_at: "2026-05-01T00:00:00Z",
          end_at: "2026-05-31T23:59:59Z",
          status: "IN_PROGRESS",
          charge_per_day: 1200,
          payout_per_day: 0
        }
      ]
    });

    const result = await payoutService.getById("PAY1", ctx);
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(result.data.diagnostics.duties_needing_rate).toHaveLength(1);
    expect(result.data.diagnostics.duties_needing_rate[0].duty_id).toBe("DUTY1");
    expect(result.data.diagnostics.warning).toMatch(/payout_per_day = 0/i);
  });
});

describe("payoutService.setEmployeePeriodPayoutRate", () => {
  it("rejects non-positive rate with validation error", async () => {
    const result = await payoutService.setEmployeePeriodPayoutRate(
      { employee_id: "EMP1", period: "2026-05", payout_per_day: 0 },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("validation_error");
  });

  it("refuses on a PAID payout — settled amounts are immutable", async () => {
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", status: "PAID" })
    });
    const result = await payoutService.setEmployeePeriodPayoutRate(
      { employee_id: "EMP1", period: "2026-05", payout_per_day: 800 },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("business_rule_violation");
  });

  it("bulk-updates zero-rate duties, recomputes, and returns refreshed detail", async () => {
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", status: "OPEN" })
    });
    vi.mocked(dutyRepository.bulkSetPayoutRateForEmployeePeriod).mockResolvedValue({
      success: true,
      data: { updated_ids: ["DUTY1", "DUTY2"] }
    });
    vi.mocked(payoutRepository.recomputeRpc).mockResolvedValue({
      success: true,
      data: { payout_id: "PAY1", duties: 2, hours: 16 }
    });
    // loadPayoutDetail fan-out
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", gross_amount: 1600, net_amount: 1600 })
    });
    vi.mocked(dutyRepository.list).mockResolvedValue({
      success: true,
      data: { rows: [], total: 0 }
    });
    vi.mocked(attendanceRepository.listForEmployeeMonth).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.listChargesByEmployeePeriod).mockResolvedValue({
      success: true,
      data: [
        { id: "C1", amount: 800, svc_key: "SVC1", date: "2026-05-01" },
        { id: "C2", amount: 800, svc_key: "SVC1", date: "2026-05-02" }
      ]
    });
    vi.mocked(dutyRepository.findZeroPayoutRateForEmployeePeriod).mockResolvedValue({
      success: true,
      data: []
    });

    const result = await payoutService.setEmployeePeriodPayoutRate(
      { employee_id: "EMP1", period: "2026-05", payout_per_day: 800 },
      ctx
    );

    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(dutyRepository.bulkSetPayoutRateForEmployeePeriod).toHaveBeenCalledWith(
      "EMP1",
      "2026-05",
      800,
      "acct@test.com",
      expect.any(Object)
    );
    expect(payoutRepository.recomputeRpc).toHaveBeenCalledWith(
      "EMP1",
      "2026-05",
      expect.any(Object)
    );
    expect(result.data.payout.gross_amount).toBe(1600);
    expect(result.data.diagnostics.duties_needing_rate).toHaveLength(0);
  });
});

describe("payoutService.getById patient_breakdown", () => {
  it("groups charges + attendance per patient with hydrated patient_name", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: payoutRow({ id: "PAY1", gross_amount: 22000, net_amount: 22000 })
    });
    // Two duties, two different patients (multi-patient assignment scenario).
    vi.mocked(dutyRepository.list).mockResolvedValue({
      success: true,
      data: {
        rows: [
          {
            id: "DUTY1",
            patient_id: "PAT1",
            employee_id: "EMP1",
            start_at: "2026-05-01T00:00:00Z",
            end_at: "2026-05-15T23:59:59Z",
            status: "IN_PROGRESS"
          },
          {
            id: "DUTY2",
            patient_id: "PAT2",
            employee_id: "EMP1",
            start_at: "2026-05-16T00:00:00Z",
            end_at: "2026-05-31T23:59:59Z",
            status: "IN_PROGRESS"
          }
        ],
        total: 2
      }
    });
    // 2 PRESENT for DUTY1 (PAT1), 1 PRESENT for DUTY2 (PAT2).
    vi.mocked(attendanceRepository.listForEmployeeMonth).mockResolvedValue({
      success: true,
      data: [
        { duty_id: "DUTY1", status: "PRESENT", hours: 8 },
        { duty_id: "DUTY1", status: "PRESENT", hours: 6 },
        { duty_id: "DUTY2", status: "PRESENT", hours: 8 }
      ]
    });
    vi.mocked(payoutRepository.listPaidTransactionsByPayout).mockResolvedValue({
      success: true,
      data: []
    });
    // Charges: DUTY1 ⇒ PAT1 (₹10000), DUTY2 ⇒ PAT2 (₹12000).
    vi.mocked(payoutRepository.listChargesByEmployeePeriod).mockResolvedValue({
      success: true,
      data: [
        {
          id: "C1",
          svc_key: "SVC1",
          date: "2026-05-01",
          amount: 5000,
          remarks: "duty:DUTY1:2026-05-01:EMP1"
        },
        {
          id: "C2",
          svc_key: "SVC1",
          date: "2026-05-02",
          amount: 5000,
          remarks: "duty:DUTY1:2026-05-02:EMP1"
        },
        {
          id: "C3",
          svc_key: "SVC2",
          date: "2026-05-16",
          amount: 12000,
          remarks: "duty:DUTY2:2026-05-16:EMP1"
        }
      ]
    });
    vi.mocked(dutyRepository.findZeroPayoutRateForEmployeePeriod).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(patientRepository.findByIds).mockResolvedValue({
      success: true,
      data: [
        { id: "PAT1", full_name: "Mr. Patel" },
        { id: "PAT2", fn: "Mrs.", ln: "Sharma" }
      ]
    });

    const result = await payoutService.getById("PAY1", ctx);
    expect(result.success).toBe(true);
    if (!result.success || !result.data) throw new Error("expected data");
    expect(result.data.patient_breakdown).toHaveLength(2);

    const byId = Object.fromEntries(
      result.data.patient_breakdown.map((p) => [p.patient_id, p])
    );
    expect(byId.PAT1.patient_name).toBe("Mr. Patel");
    expect(byId.PAT1.amount).toBe(10000);
    expect(byId.PAT1.days_worked).toBe(2);
    expect(byId.PAT1.charged_days).toBe(2);
    expect(byId.PAT1.first_date).toBe("2026-05-01");
    expect(byId.PAT1.last_date).toBe("2026-05-02");

    expect(byId.PAT2.patient_name).toBe("Mrs. Sharma");
    expect(byId.PAT2.amount).toBe(12000);
    expect(byId.PAT2.days_worked).toBe(1);
    expect(byId.PAT2.hours).toBe(8);
  });
});

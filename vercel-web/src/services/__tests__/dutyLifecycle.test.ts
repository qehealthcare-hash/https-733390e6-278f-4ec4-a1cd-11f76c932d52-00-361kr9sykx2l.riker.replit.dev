import { describe, expect, it, vi, beforeEach } from "vitest";
import { dutyService } from "@/services/dutyService";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { dutyRepository } from "@/database/dutyRepository";
import { billingRepository } from "@/database/billingRepository";
import { employeeRepository } from "@/database/employeeRepository";

vi.mock("@/database/dutyRepository");
vi.mock("@/database/billingRepository");
vi.mock("@/database/employeeRepository");
vi.mock("@/database/attendanceRepository", () => ({
  attendanceRepository: {
    findByDutyId: vi.fn().mockResolvedValue({ success: true, data: null }),
    insert: vi.fn(),
    update: vi.fn()
  }
}));
vi.mock("@/database/payoutRepository", () => ({
  payoutRepository: { recomputeRpc: vi.fn().mockResolvedValue({ success: true, data: null }) }
}));
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "ops@test.com", accessToken: "tok" } };

const baseDuty = {
  id: "DUTY1",
  patient_id: "PAT1",
  employee_id: "EMP1",
  service_name: "Care Taker Services",
  service_type: "Care Taker Services",
  shift_type: "DAY",
  start_at: "2026-05-01T08:00:00Z",
  end_at: "2026-05-03T16:00:00Z",
  status: "SCHEDULED",
  charge_per_day: 500,
  payout_per_day: 300,
  payout_term: "Daily",
  extra_partners: [],
  updated_at: "2026-05-01T00:00:00Z"
};

describe("dutyDiaryService.materializeDuty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates per-day svc + payout rows idempotently", async () => {
    vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active" }
    });
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "EMP1", full_name: "Alice" }
    });
    vi.mocked(billingRepository.findSvcByDayPartner).mockResolvedValue({ success: true, data: null });
    vi.mocked(billingRepository.findPayoutByDayPartner).mockResolvedValue({ success: true, data: null });
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({ success: true, data: [] });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({ success: true, data: [] });
    vi.mocked(billingRepository.insertSvc).mockResolvedValue({ success: true, data: { id: 1 } });
    vi.mocked(billingRepository.insertPayoutCharge).mockResolvedValue({ success: true, data: { id: 2 } });
    vi.mocked(dutyRepository.update).mockResolvedValue({ success: true, data: baseDuty });

    const result = await dutyDiaryService.materializeDuty(baseDuty, ctx);
    expect(result.success).toBe(true);
    expect(result.data?.created_svc).toBe(3);
    expect(result.data?.created_payout).toBe(3);
    expect(result.data?.svc_key).toBe("BILL1_Care Taker Services");
    expect(billingRepository.insertSvc).toHaveBeenCalledTimes(3);
    expect(billingRepository.insertPayoutCharge).toHaveBeenCalledTimes(3);
  });

  it("updates existing diary rows when rates change", async () => {
    vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active" }
    });
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "EMP1", full_name: "Alice" }
    });
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: true,
      data: [
        {
          id: 10,
          remarks: "duty:DUTY1:2026-05-01:EMP1",
          amt: 100,
          total: 100
        }
      ]
    });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({
      success: true,
      data: [{ id: 20, remarks: "duty:DUTY1:2026-05-01:EMP1", amount: 50 }]
    });
    vi.mocked(billingRepository.findSvcByDayPartner).mockResolvedValue({
      success: true,
      data: { id: 10, remarks: "duty:DUTY1:2026-05-01:EMP1", amt: 100, total: 100 }
    });
    vi.mocked(billingRepository.findPayoutByDayPartner).mockResolvedValue({
      success: true,
      data: { id: 20, remarks: "duty:DUTY1:2026-05-01:EMP1", amount: 50 }
    });
    vi.mocked(billingRepository.updateSvc).mockResolvedValue({ success: true, data: { id: 10 } });
    vi.mocked(billingRepository.updatePayoutCharge).mockResolvedValue({ success: true, data: { id: 20 } });
    vi.mocked(billingRepository.insertSvc).mockResolvedValue({ success: true, data: { id: 1 } });
    vi.mocked(billingRepository.insertPayoutCharge).mockResolvedValue({ success: true, data: { id: 2 } });
    vi.mocked(dutyRepository.update).mockResolvedValue({ success: true, data: baseDuty });

    const oneDay = {
      ...baseDuty,
      end_at: "2026-05-01T16:00:00Z",
      charge_per_day: 500,
      payout_per_day: 300
    };
    const result = await dutyDiaryService.materializeDuty(oneDay, ctx);
    expect(result.success).toBe(true);
    expect(result.data?.updated_svc).toBeGreaterThanOrEqual(1);
    expect(result.data?.updated_payout).toBeGreaterThanOrEqual(1);
  });
});

describe("dutyService.cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rolls back diary rows when no receipts", async () => {
    vi.mocked(dutyRepository.findById)
      .mockResolvedValueOnce({ success: true, data: { ...baseDuty, billing_id: "BILL1" } })
      .mockResolvedValueOnce({
        success: true,
        data: { ...baseDuty, status: "CANCELLED", billing_id: "BILL1" }
      });
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: true,
      data: [{ id: 1 }]
    });
    vi.mocked(dutyRepository.findSvcEntriesForDuty).mockResolvedValue({ success: true, data: [] });
    vi.mocked(dutyRepository.countActiveReceipts).mockResolvedValue({ success: true, data: 0 });
    vi.mocked(dutyRepository.removeSvcEntriesByDutyId).mockResolvedValue({ success: true, data: null });
    vi.mocked(dutyRepository.removePayoutChargesByDutyId).mockResolvedValue({ success: true, data: null });
    vi.mocked(dutyRepository.update).mockResolvedValue({
      success: true,
      data: { ...baseDuty, status: "CANCELLED" }
    });

    const result = await dutyService.cancel("DUTY1", { reason: "test" }, ctx);
    expect(result.success).toBe(true);
    expect(dutyRepository.removePayoutChargesByDutyId).toHaveBeenCalledWith("DUTY1", expect.anything());
  });
});

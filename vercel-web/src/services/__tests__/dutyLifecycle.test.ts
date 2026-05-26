import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { dutyService } from "@/services/dutyService";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { dutyRepository } from "@/database/dutyRepository";
import { billingRepository } from "@/database/billingRepository";
import { employeeRepository } from "@/database/employeeRepository";
import { payoutRepository } from "@/database/payoutRepository";

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
  payoutRepository: {
    recomputeRpc: vi.fn().mockResolvedValue({ success: true, data: null }),
    isDayPaid: vi.fn().mockResolvedValue({ success: true, data: false }),
    anyDayPaid: vi.fn().mockResolvedValue({ success: true, data: { paid: false } }),
    findByEmployeePeriod: vi.fn().mockResolvedValue({ success: true, data: null })
  }
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
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: null
    });
  });

  it("skips payout charge mutations when employee period payout is LOCKED", async () => {
    vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active" }
    });
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "EMP1", full_name: "Alice" }
    });
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValueOnce({
      success: true,
      data: { id: "PAY1", employee_id: "EMP1", period_month: "2026-05", status: "LOCKED" }
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
    expect(billingRepository.insertSvc).toHaveBeenCalled();
    expect(billingRepository.insertPayoutCharge).not.toHaveBeenCalled();
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
    expect(dutyRepository.update).toHaveBeenCalledWith(
      "DUTY1",
      expect.objectContaining({ billing_id: "BILL1" }),
      expect.anything()
    );
  });

  it("skips duty billing_id update when already linked", async () => {
    vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active" }
    });
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "EMP1", fn: "Alice", mn: "", ln: "" }
    });
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({ success: true, data: [] });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({ success: true, data: [] });
    vi.mocked(billingRepository.insertSvc).mockResolvedValue({ success: true, data: { id: 1 } });
    vi.mocked(billingRepository.insertPayoutCharge).mockResolvedValue({ success: true, data: { id: 2 } });

    await dutyDiaryService.materializeDuty({ ...baseDuty, billing_id: "BILL1" }, ctx);
    expect(dutyRepository.update).not.toHaveBeenCalled();
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

describe("open-ended duty (no end_at)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("materializes only through today when end_at is the open-ended sentinel", async () => {
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

    const openEnded = {
      ...baseDuty,
      start_at: "2026-05-01T08:00:00Z",
      end_at: "2099-12-31T23:59:59Z"
    };
    const result = await dutyDiaryService.materializeDuty(openEnded, ctx);
    expect(result.success).toBe(true);
    // May 1, 2, 3, 4 inclusive = 4 days through "today"
    expect(result.data?.created_svc).toBe(4);
    expect(result.data?.created_payout).toBe(4);
  });

  it("does not materialize future days beyond today even when end_at is in the future", async () => {
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

    const future = {
      ...baseDuty,
      start_at: "2026-05-01T08:00:00Z",
      end_at: "2026-06-01T16:00:00Z"
    };
    const result = await dutyDiaryService.materializeDuty(future, ctx);
    expect(result.success).toBe(true);
    expect(result.data?.created_svc).toBe(4);
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
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({
      success: true,
      data: [{ partner_id: "EMP1" }]
    });

    const result = await dutyService.cancel("DUTY1", { reason: "test" }, ctx);
    expect(result.success).toBe(true);
    expect(dutyRepository.removePayoutChargesByDutyId).toHaveBeenCalledWith("DUTY1", expect.anything());
  });

  it("refuses to cancel a COMPLETED duty", async () => {
    vi.mocked(dutyRepository.findById).mockResolvedValue({
      success: true,
      data: { ...baseDuty, status: "COMPLETED" }
    });

    const result = await dutyService.cancel("DUTY1", { reason: "done" }, ctx);
    expect(result.success).toBe(false);
    expect(String(result.error || "").toLowerCase()).toContain("completed");
  });
});

describe("dutyDiaryService.updateDay partner reassignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites partner_id, partner name, and remarks when new_employee_id differs", async () => {
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: true,
      data: [{ id: 7, remarks: "duty:DUTY1:2026-05-01:EMP1", amt: 500, total: 500 }]
    });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({
      success: true,
      data: [{ id: 8, remarks: "duty:DUTY1:2026-05-01:EMP1", amount: 300 }]
    });
    vi.mocked(dutyRepository.findById).mockResolvedValue({
      success: true,
      data: {
        id: "DUTY1",
        employee_id: "EMP1",
        extra_partners: [],
        charge_per_day: 500,
        payout_per_day: 300,
        payout_term: "Daily"
      }
    });
    vi.mocked(dutyRepository.update).mockResolvedValue({ success: true, data: { id: "DUTY1" } });
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "EMP2", full_name: "Bob" }
    });
    vi.mocked(billingRepository.updateSvc).mockResolvedValue({ success: true, data: { id: 7 } });
    vi.mocked(billingRepository.updatePayoutCharge).mockResolvedValue({ success: true, data: { id: 8 } });

    const out = await dutyDiaryService.updateDay(
      "DUTY1",
      "2026-05-01",
      "EMP1",
      { new_employee_id: "EMP2" },
      ctx
    );
    expect(out.success).toBe(true);
    expect(out.data?.partner_changed).toBe(true);
    expect(out.data?.employee_id).toBe("EMP2");
    expect(out.data?.promoted_partner).toBe(true);
    expect(billingRepository.updateSvc).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({
        partner_id: "EMP2",
        partner: "Bob",
        remarks: "duty:DUTY1:2026-05-01:EMP2:m"
      }),
      expect.anything()
    );
    expect(billingRepository.updatePayoutCharge).toHaveBeenCalledWith(
      "8",
      expect.objectContaining({
        partner_id: "EMP2",
        partner: "Bob",
        remarks: "duty:DUTY1:2026-05-01:EMP2:m"
      }),
      expect.anything()
    );
    expect(dutyRepository.update).toHaveBeenCalledWith(
      "DUTY1",
      expect.objectContaining({
        extra_partners: expect.arrayContaining([
          expect.objectContaining({ employee_id: "EMP2" })
        ])
      }),
      expect.anything()
    );
  });

  it("refuses to reassign if the target partner already has an entry that day", async () => {
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: true,
      data: [
        { id: 7, remarks: "duty:DUTY1:2026-05-01:EMP1", amt: 500, total: 500 },
        { id: 9, remarks: "duty:DUTY1:2026-05-01:EMP2", amt: 500, total: 500 }
      ]
    });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({ success: true, data: [] });

    const out = await dutyDiaryService.updateDay(
      "DUTY1",
      "2026-05-01",
      "EMP1",
      { new_employee_id: "EMP2" },
      ctx
    );
    expect(out.success).toBe(false);
    expect(String(out.code || "").toLowerCase()).toBe("duplicate");
    expect(billingRepository.updateSvc).not.toHaveBeenCalled();
  });
});

describe("dutyDiaryService manual override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not overwrite a row whose remarks carry the :m manual marker", async () => {
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
          id: 99,
          remarks: "duty:DUTY1:2026-05-01:EMP1:m",
          amt: 9999,
          total: 9999
        }
      ]
    });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({
      success: true,
      data: [{ id: 100, remarks: "duty:DUTY1:2026-05-01:EMP1:m", amount: 7777 }]
    });
    vi.mocked(billingRepository.updateSvc).mockResolvedValue({ success: true, data: { id: 99 } });
    vi.mocked(billingRepository.updatePayoutCharge).mockResolvedValue({ success: true, data: { id: 100 } });
    vi.mocked(dutyRepository.update).mockResolvedValue({ success: true, data: baseDuty });

    const oneDay = {
      ...baseDuty,
      start_at: "2026-05-01T08:00:00Z",
      end_at: "2026-05-01T16:00:00Z",
      charge_per_day: 500,
      payout_per_day: 300
    };
    const result = await dutyDiaryService.materializeDuty(oneDay, ctx);
    expect(result.success).toBe(true);
    expect(billingRepository.updateSvc).not.toHaveBeenCalled();
    expect(billingRepository.updatePayoutCharge).not.toHaveBeenCalled();
    expect(result.data?.skipped).toBeGreaterThanOrEqual(2);
  });
});

describe("dutyDiaryService rollback paid guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses rollback when any diary day was already disbursed", async () => {
    const payoutMod = await import("@/database/payoutRepository");
    vi.mocked(payoutMod.payoutRepository.anyDayPaid).mockResolvedValueOnce({
      success: true,
      data: { paid: true, employee_id: "EMP1", iso_date: "2026-05-01" }
    });
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: true,
      data: [{ id: 1, remarks: "duty:DUTY1:2026-05-01:EMP1", amt: 500, total: 500 }]
    });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({
      success: true,
      data: [{ id: 2, remarks: "duty:DUTY1:2026-05-01:EMP1", amount: 300 }]
    });

    const out = await dutyDiaryService.rollbackDutyDiary("DUTY1", ctx);
    expect(out.success).toBe(false);
    expect(String(out.error || "")).toMatch(/paid_transactions/i);
    expect(dutyRepository.removeSvcEntriesByDutyId).not.toHaveBeenCalled();
  });
});

describe("dutyDiaryService paid-charge guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses updateDay when the source partner already has a paid transaction on that date", async () => {
    const payoutMod = await import("@/database/payoutRepository");
    vi.mocked(payoutMod.payoutRepository.isDayPaid).mockResolvedValueOnce({ success: true, data: true });

    const out = await dutyDiaryService.updateDay(
      "DUTY1",
      "2026-05-01",
      "EMP1",
      { charge: 999 },
      ctx
    );
    expect(out.success).toBe(false);
    expect(String(out.error || "")).toMatch(/disbursed|paid/i);
    expect(billingRepository.updateSvc).not.toHaveBeenCalled();
  });

  it("refuses deleteDay when the source partner already has a paid transaction", async () => {
    const payoutMod = await import("@/database/payoutRepository");
    vi.mocked(payoutMod.payoutRepository.isDayPaid).mockResolvedValueOnce({ success: true, data: true });

    const out = await dutyDiaryService.deleteDay("DUTY1", "2026-05-01", "EMP1", ctx);
    expect(out.success).toBe(false);
    expect(String(out.error || "")).toMatch(/disbursed|paid/i);
    expect(billingRepository.removeSvc).not.toHaveBeenCalled();
  });
});

describe("dutyDiaryService pruner :m guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves manual rows whose date is inside the duty window even when extra_partners no longer lists the partner", async () => {
    vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active" }
    });
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "EMP1", full_name: "Alice" }
    });
    // Existing svc/payout rows include the primary partner row (no :m) AND
    // an orphan :m row attributed to EMP2 (a partner not in extra_partners).
    // The orphan must NOT be deleted because its date is inside the
    // duty window — it was manually reassigned and is still owed.
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: true,
      data: [
        { id: 7, remarks: "duty:DUTY1:2026-05-01:EMP1", amt: 500, total: 500 },
        { id: 8, remarks: "duty:DUTY1:2026-05-01:EMP2:m", amt: 500, total: 500 }
      ]
    });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({
      success: true,
      data: [
        { id: 9, remarks: "duty:DUTY1:2026-05-01:EMP1", amount: 300 },
        { id: 10, remarks: "duty:DUTY1:2026-05-01:EMP2:m", amount: 300 }
      ]
    });
    vi.mocked(billingRepository.findSvcByDayPartner).mockResolvedValue({ success: true, data: null });
    vi.mocked(billingRepository.findPayoutByDayPartner).mockResolvedValue({ success: true, data: null });
    vi.mocked(billingRepository.removeSvc).mockResolvedValue({ success: true, data: null });
    vi.mocked(billingRepository.removePayoutCharge).mockResolvedValue({ success: true, data: null });
    vi.mocked(dutyRepository.update).mockResolvedValue({ success: true, data: baseDuty });

    const oneDay = {
      ...baseDuty,
      start_at: "2026-05-01T08:00:00Z",
      end_at: "2026-05-01T16:00:00Z"
    };
    const result = await dutyDiaryService.materializeDuty(oneDay, ctx);
    expect(result.success).toBe(true);
    // EMP2's manual row must survive even though it's not in extra_partners.
    expect(billingRepository.removeSvc).not.toHaveBeenCalled();
    expect(billingRepository.removePayoutCharge).not.toHaveBeenCalled();
  });
});

describe("dutyService.extendActive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips duties whose patient has no active bill instead of erroring", async () => {
    vi.mocked(dutyRepository.findActive).mockResolvedValue({
      success: true,
      data: [
        { ...baseDuty, id: "DUTY_A", patient_id: "PAT_NOBILL" },
        { ...baseDuty, id: "DUTY_B", patient_id: "PAT_OK" }
      ]
    });
    vi.mocked(billingRepository.findActiveByPatient).mockImplementation(async (pid: string) => {
      if (pid === "PAT_OK") return { success: true, data: { id: "BILL_OK", status: "Active" } };
      return { success: true, data: null };
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

    const out = await dutyService.extendActive(ctx);
    expect(out.success).toBe(true);
    expect(out.data?.processed).toBe(2);
    expect(out.data?.skipped_no_bill).toBe(1);
    expect(out.data?.errors).toEqual([]);
    expect(out.data?.created_svc).toBeGreaterThan(0);
  });

  it("aggregates materialize errors per duty without throwing", async () => {
    vi.mocked(dutyRepository.findActive).mockResolvedValue({
      success: true,
      data: [{ ...baseDuty, id: "DUTY_BAD" }]
    });
    vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active" }
    });
    vi.mocked(employeeRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "EMP1", full_name: "Alice" }
    });
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: false,
      error: "boom",
      code: "INTERNAL"
    });

    const out = await dutyService.extendActive(ctx);
    expect(out.success).toBe(true);
    expect(out.data?.errors).toHaveLength(1);
    expect(out.data?.errors?.[0].duty_id).toBe("DUTY_BAD");
  });
});

describe("patient-side overlap guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks a second duty on the same patient at the same time unless confirmed", async () => {
    vi.mocked(dutyRepository.findOverlapping).mockResolvedValue({ success: true, data: [] });
    vi.mocked(dutyRepository.findOverlappingForPatient).mockResolvedValue({
      success: true,
      data: [
        {
          id: "DUTY_EXISTING",
          employee_id: "EMP_OTHER",
          patient_id: "PAT1",
          start_at: "2026-05-01T08:00:00Z",
          end_at: "2026-05-03T16:00:00Z",
          status: "SCHEDULED"
        }
      ]
    });
    vi.mocked(dutyRepository.findById).mockResolvedValue({ success: true, data: null });

    const result = await dutyService.create(
      {
        patient_id: "PAT1",
        employee_id: "EMP_NEW",
        service_name: "Care Taker Services",
        service_type: "Care Taker Services",
        shift_type: "DAY",
        start_at: "2026-05-02T08:00:00Z",
        end_at: "2026-05-02T16:00:00Z",
        status: "SCHEDULED",
        charge_per_day: 500,
        payout_per_day: 300,
        payout_term: "Daily",
        materialize: false
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(String(result.code || "").toLowerCase()).toBe("duplicate");
    expect((result.details as { field?: string })?.field).toBe("patient_window");
  });

  it("allows the duty through when confirm_patient_overlap is true", async () => {
    vi.mocked(dutyRepository.findOverlapping).mockResolvedValue({ success: true, data: [] });
    vi.mocked(dutyRepository.findOverlappingForPatient).mockResolvedValue({
      success: true,
      data: [
        {
          id: "DUTY_EXISTING",
          employee_id: "EMP_OTHER",
          patient_id: "PAT1",
          start_at: "2026-05-01T08:00:00Z",
          end_at: "2026-05-03T16:00:00Z",
          status: "SCHEDULED"
        }
      ]
    });
    vi.mocked(dutyRepository.insert).mockResolvedValue({
      success: true,
      data: { ...baseDuty, id: "DUTY_NEW" }
    });
    vi.mocked(dutyRepository.findById).mockResolvedValue({
      success: true,
      data: { ...baseDuty, id: "DUTY_NEW" }
    });

    const result = await dutyService.create(
      {
        patient_id: "PAT1",
        employee_id: "EMP_NEW",
        service_name: "Care Taker Services",
        service_type: "Care Taker Services",
        shift_type: "DAY",
        start_at: "2026-05-02T08:00:00Z",
        end_at: "2026-05-02T16:00:00Z",
        status: "SCHEDULED",
        charge_per_day: 500,
        payout_per_day: 300,
        payout_term: "Daily",
        materialize: false,
        confirm_patient_overlap: true
      },
      ctx
    );

    expect(result.success).toBe(true);
  });
});

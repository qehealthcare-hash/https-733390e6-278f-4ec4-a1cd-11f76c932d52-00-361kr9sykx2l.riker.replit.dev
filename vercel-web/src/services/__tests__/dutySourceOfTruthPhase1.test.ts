/**
 * Phase 1 SSOT regression tests — duty calendar as single source of truth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "@/types/common";
import {
  DUTY_CALENDAR_ATTENDANCE_SOT_MESSAGE,
  DUTY_CALENDAR_BILLING_GENERATE_DISABLED_MESSAGE,
  DUTY_CALENDAR_LEDGER_REPLACE_DISABLED_MESSAGE
} from "@/business/dutySourceOfTruth";
import { recomputePayoutIfEditable } from "@/services/recomputePayoutIfEditable";
import { computeDashboardDutyKpisFromLedger } from "@/src/lib/duty-ledger";
import { isDutyDiaryRemarks } from "@/business/dutyDiaryRules";
import { billingService } from "@/services/billingService";
import { payoutService } from "@/services/payoutService";
import { attendanceService } from "@/services/attendanceService";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { dutyService } from "@/services/dutyService";
import { dutyRepository } from "@/database/dutyRepository";
import { billingRepository } from "@/database/billingRepository";
import { payoutRepository } from "@/database/payoutRepository";

vi.mock("@/database/dutyRepository");
vi.mock("@/database/billingRepository", () => ({
  billingRepository: {
    listBillingsByPatient: vi.fn().mockResolvedValue({ success: true, data: [] }),
    listActiveReceiptsByBillingIds: vi.fn().mockResolvedValue({ success: true, data: [] }),
    findActiveByPatient: vi.fn().mockResolvedValue({ success: true, data: null })
  }
}));
vi.mock("@/database/payoutRepository", () => ({
  payoutRepository: {
    findByEmployeePeriod: vi.fn(),
    recomputeRpc: vi.fn(),
    isDayPaid: vi.fn().mockResolvedValue({ success: true, data: false }),
    anyDayPaid: vi.fn().mockResolvedValue({ success: true, data: { paid: false } })
  }
}));
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const materializeOk = {
  billing_id: "B1",
  svc_key: "k",
  created_svc: 0,
  created_payout: 0,
  updated_svc: 0,
  updated_payout: 0,
  deleted_svc: 0,
  deleted_payout: 0,
  skipped: 0,
  days: 0
};

const ctx = { actor: { email: "ops@test.com", accessToken: "tok" } };

describe("Phase 1 — strict write blocks", () => {
  it("blocks billing generateFromDuty", async () => {
    const r = await billingService.generateFromDuty({}, ctx);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain(DUTY_CALENDAR_BILLING_GENERATE_DISABLED_MESSAGE.slice(0, 20));
    expect(r.code).toBe(ErrorCodes.business);
  });

  it("blocks billing generateFromDutyRange", async () => {
    const r = await billingService.generateFromDutyRange({}, ctx);
    expect(r.success).toBe(false);
  });

  it("blocks manual svc slice replace", async () => {
    const r = await billingService.replaceServiceEntries({ svc_key: "k", rows: [] }, ctx);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("disabled");
  });

  it("blocks manual payout charge replace", async () => {
    const r = await payoutService.replacePayoutCharges({ svc_key: "k", rows: [] }, ctx);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain(DUTY_CALENDAR_LEDGER_REPLACE_DISABLED_MESSAGE.slice(0, 20));
  });

  it("blocks manual attendance create/update/mark/remove", async () => {
    for (const fn of [
      () => attendanceService.create({}, ctx),
      () => attendanceService.update("A1", {}, ctx),
      () => attendanceService.mark({}, ctx),
      () => attendanceService.remove("A1", ctx)
    ]) {
      const r = await fn();
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error).toContain(DUTY_CALENDAR_ATTENDANCE_SOT_MESSAGE.slice(0, 20));
      }
    }
  });
});

describe("Phase 1 — ledger KPIs", () => {
  it("counts only duty-remarks svc rows for dashboard KPIs", () => {
    const duties = new Map([
      ["D1", { id: "D1", status: "COMPLETED" }],
      ["D2", { id: "D2", status: "SCHEDULED" }]
    ]);
    const kpis = computeDashboardDutyKpisFromLedger(
      [
        { remarks: "duty:D1:2026-05-01:EMP1", id: 1 },
        { remarks: "duty:D2:2026-05-02:EMP1", id: 2 },
        { remarks: "manual:line", id: 3 }
      ],
      duties
    );
    expect(kpis.duties_completed).toBe(1);
    expect(kpis.duties_scheduled).toBe(1);
    expect(kpis.duties_active).toBe(0);
  });

  it("isDutyDiaryRemarks identifies materialized rows", () => {
    expect(isDutyDiaryRemarks("duty:D1:2026-05-01:EMP1")).toBe(true);
    expect(isDutyDiaryRemarks("manual")).toBe(false);
  });
});

describe("Phase 1 — payout freeze guard helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips recompute when payout period is LOCKED", async () => {
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: { id: "P1", status: "LOCKED" }
    });
    await recomputePayoutIfEditable("EMP1", "2026-05", { accessToken: "tok" });
    expect(payoutRepository.recomputeRpc).not.toHaveBeenCalled();
  });

  it("recomputes when payout period is OPEN", async () => {
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: { id: "P1", status: "OPEN" }
    });
    vi.mocked(payoutRepository.recomputeRpc).mockResolvedValue({ success: true, data: null });
    await recomputePayoutIfEditable("EMP1", "2026-05", { accessToken: "tok" });
    expect(payoutRepository.recomputeRpc).toHaveBeenCalledWith("EMP1", "2026-05", {
      accessToken: "tok"
    });
  });
});

describe("Phase 1 — window-clipped materialize prune", () => {
  const baseDuty = {
    id: "DUTY1",
    patient_id: "PAT1",
    employee_id: "EMP1",
    service_name: "Care Taker Services",
    shift_type: "DAY",
    start_at: "2026-05-01T08:00:00Z",
    end_at: "2026-05-31T16:00:00Z",
    status: "SCHEDULED",
    charge_per_day: 500,
    payout_per_day: 300,
    payout_term: "Daily",
    extra_partners: [],
    updated_at: "2026-05-01T00:00:00Z"
  };

  it("rematerializeForEmployeePeriod passes prune:false", async () => {
    const spy = vi.spyOn(dutyDiaryService, "materializeDuty").mockResolvedValue({
      success: true,
      data: materializeOk
    });
    vi.mocked(dutyRepository.list).mockResolvedValue({
      success: true,
      data: { rows: [baseDuty], total: 1 }
    });
    await dutyDiaryService.rematerializeForEmployeePeriod("EMP1", "2026-05", ctx);
    expect(spy).toHaveBeenCalledWith(
      baseDuty,
      ctx,
      expect.objectContaining({ from: "2026-05-01", to: "2026-05-31", prune: false })
    );
    spy.mockRestore();
  });
});

describe("Phase 1 — create compensating rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: null
    });
  });

  it("rolls back diary rows when materialize fails after duty insert", async () => {
    const rollbackSpy = vi.spyOn(dutyDiaryService, "rollbackDutyDiary").mockResolvedValue({
      success: true,
      data: null
    });
    const materializeSpy = vi.spyOn(dutyDiaryService, "materializeDuty").mockResolvedValue({
      success: false,
      error: "materialize failed",
      code: ErrorCodes.business
    });

    vi.mocked(dutyRepository.findOverlapping).mockResolvedValue({ success: true, data: [] });
    vi.mocked(dutyRepository.findOverlappingForPatient).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(dutyRepository.insert).mockResolvedValue({
      success: true,
      data: { id: "DNEW", status: "SCHEDULED" }
    });
    vi.mocked(dutyRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "DNEW", status: "SCHEDULED", patient_id: "P1", employee_id: "E1" }
    });
    vi.mocked(dutyRepository.remove).mockResolvedValue({ success: true, data: null });

    const result = await dutyService.create(
      {
        id: "DNEW",
        patient_id: "P1",
        employee_id: "E1",
        shift_type: "DAY",
        start_at: "2026-06-01T08:00:00Z",
        end_at: "2026-06-10T16:00:00Z",
        status: "SCHEDULED",
        service_name: "Care Taker Services",
        materialize: true
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(rollbackSpy).toHaveBeenCalledWith("DNEW", ctx);
    expect(dutyRepository.remove).toHaveBeenCalled();

    rollbackSpy.mockRestore();
    materializeSpy.mockRestore();
  });
});

describe("Phase 1 — update compensating rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
      success: true,
      data: null
    });
    vi.mocked(dutyRepository.countActiveReceipts).mockResolvedValue({
      success: true,
      data: 0
    });
    vi.mocked(dutyRepository.findSvcEntriesByDutyId).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(dutyRepository.findPayoutChargesByDutyId).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(dutyRepository.findOverlapping).mockResolvedValue({ success: true, data: [] });
    vi.mocked(dutyRepository.findOverlappingForPatient).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(payoutRepository.findByEmployeePeriod).mockResolvedValue({
      success: true,
      data: null
    });
  });

  it("restores prior duty state when materialize fails on update", async () => {
    const existingDuty = {
      id: "D1",
      patient_id: "P1",
      employee_id: "E1",
      service_name: "Care Taker Services",
      shift_type: "DAY",
      start_at: "2026-06-01T08:00:00Z",
      end_at: "2026-06-10T16:00:00Z",
      status: "SCHEDULED",
      charge_per_day: 500,
      payout_per_day: 300,
      payout_term: "Daily",
      extra_partners: [],
      excluded_days: [],
      updated_at: "2026-06-01T00:00:00Z"
    };
    const materializeSpy = vi
      .spyOn(dutyDiaryService, "materializeDuty")
      .mockResolvedValueOnce({
        success: false,
        error: "sync failed",
        code: ErrorCodes.business
      })
      .mockResolvedValueOnce({ success: true, data: materializeOk });

    vi.mocked(dutyRepository.findById)
      .mockResolvedValueOnce({ success: true, data: existingDuty })
      .mockResolvedValueOnce({ success: true, data: { ...existingDuty, charge_per_day: 600 } });
    vi.mocked(dutyRepository.update).mockResolvedValue({ success: true, data: existingDuty });

    const result = await dutyService.update(
      "D1",
      {
        patient_id: "P1",
        employee_id: "E1",
        service_name: "Care Taker Services",
        service_type: "Care Taker Services",
        shift_type: "DAY",
        start_at: "2026-06-01T08:00:00Z",
        end_at: "2026-06-10T16:00:00Z",
        status: "SCHEDULED",
        charge_per_day: 600,
        payout_per_day: 300,
        payout_term: "Daily",
        materialize: true,
        expected_updated_at: "2026-06-01T00:00:00Z"
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(dutyRepository.update).toHaveBeenCalledTimes(2);
    expect(materializeSpy).toHaveBeenCalledTimes(2);
    expect(materializeSpy.mock.calls[1]?.[0]).toEqual(existingDuty);

    materializeSpy.mockRestore();
  });
});

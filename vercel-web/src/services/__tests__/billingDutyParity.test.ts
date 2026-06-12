import { beforeEach, describe, expect, it, vi } from "vitest";

import { billingService } from "@/services/billingService";
import { billingRepository } from "@/database/billingRepository";

vi.mock("@/database/billingRepository");
vi.mock("@/database/patientRepository", () => ({
  patientRepository: {
    findById: vi.fn().mockResolvedValue({ success: true, data: null })
  }
}));
vi.mock("@/database/dutyRepository");

const extendForPatient = vi.fn().mockResolvedValue({
  success: true,
  data: {
    processed: 1,
    created_svc: 4,
    created_payout: 4,
    updated_svc: 0,
    updated_payout: 0,
    deleted_svc: 0,
    deleted_payout: 0,
    skipped: 0,
    skipped_no_bill: 0,
    errors: []
  }
});
vi.mock("@/services/dutyService", () => ({
  dutyService: {
    extendForPatient: (...args: unknown[]) => extendForPatient(...args)
  }
}));
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "ops@test.com", accessToken: "tok" } };

function mockActiveBill() {
  vi.mocked(billingRepository.findActiveByPatient).mockResolvedValue({
    success: true,
    data: {
      id: "BILL1",
      patient_id: "PAT1",
      status: "Active",
      updated_at: "2026-06-02T00:00:00.000Z",
      sec_dep: 0
    }
  });
  vi.mocked(billingRepository.dedupBillingDiaryRpc).mockResolvedValue({
    success: true,
    data: {
      svc_phantoms_deleted: 0,
      payout_phantoms_deleted: 0,
      svc_duplicates_deleted: 0,
      payout_duplicates_deleted: 0
    }
  });
  vi.mocked(billingRepository.findBillingById).mockResolvedValue({
    success: true,
    data: {
      id: "BILL1",
      patient_id: "PAT1",
      status: "Active",
      updated_at: "2026-06-02T00:00:00.000Z",
      sec_dep: 0
    }
  });
  vi.mocked(billingRepository.loadBillingBundle).mockResolvedValue({
    success: true,
    data: {
      billing: {
        id: "BILL1",
        patient_id: "PAT1",
        status: "Active",
        updated_at: "2026-06-02T00:00:00.000Z",
        sec_dep: 0
      },
      services: [],
      receipts: []
    }
  });
  vi.mocked(billingRepository.listInvoicesByBilling).mockResolvedValue({
    success: true,
    data: []
  });
}

describe("billingService.syncDutyLedgerForPatient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extendForPatient.mockResolvedValue({
      success: true,
      data: {
        processed: 1,
        created_svc: 4,
        created_payout: 4,
        updated_svc: 0,
        updated_payout: 0,
        deleted_svc: 0,
        deleted_payout: 0,
        skipped: 0,
        skipped_no_bill: 0,
        errors: []
      }
    });
  });

  it("extends all billable duties then runs billing dedup RPC", async () => {
    mockActiveBill();
    const result = await billingService.syncDutyLedgerForPatient("PAT1", ctx);
    expect(result.success).toBe(true);
    expect(extendForPatient).toHaveBeenCalledWith("PAT1", ctx);
    expect(billingRepository.dedupBillingDiaryRpc).toHaveBeenCalledWith("BILL1", expect.anything());
    expect(result.data?.created_svc).toBe(4);
  });
});

describe("billingService.getById ↔ duty calendar parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extendForPatient.mockResolvedValue({
      success: true,
      data: {
        processed: 0,
        created_svc: 0,
        created_payout: 0,
        updated_svc: 0,
        updated_payout: 0,
        deleted_svc: 0,
        deleted_payout: 0,
        skipped: 0,
        skipped_no_bill: 0,
        errors: []
      }
    });
  });

  it("does not run heavy duty-ledger sync during a normal bill detail read", async () => {
    mockActiveBill();
    const result = await billingService.getById("BILL1", ctx);
    expect(result.success).toBe(true);
    expect(extendForPatient).not.toHaveBeenCalled();
    expect(billingRepository.dedupBillingDiaryRpc).not.toHaveBeenCalled();
  });

  it("can still opt into duty-ledger sync before assembling an Active bill bundle", async () => {
    mockActiveBill();
    const result = await billingService.getById("BILL1", {
      ...ctx,
      syncDutyLedgerOnRead: true
    });
    expect(result.success).toBe(true);
    expect(extendForPatient).toHaveBeenCalledWith("PAT1", expect.objectContaining({ actor: expect.any(Object) }));
    expect(billingRepository.dedupBillingDiaryRpc).toHaveBeenCalled();
  });

  it("skips sync for a Closed bill", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: {
        id: "BILL_CLOSED",
        patient_id: "PAT2",
        status: "Closed",
        updated_at: "2026-06-02T00:00:00.000Z",
        sec_dep: 0
      }
    });
    vi.mocked(billingRepository.loadBillingBundle).mockResolvedValue({
      success: true,
      data: {
        billing: {
          id: "BILL_CLOSED",
          patient_id: "PAT2",
          status: "Closed",
          updated_at: "2026-06-02T00:00:00.000Z",
          sec_dep: 0
        },
        services: [],
        receipts: []
      }
    });
    vi.mocked(billingRepository.listInvoicesByBilling).mockResolvedValue({
      success: true,
      data: []
    });

    const result = await billingService.getById("BILL_CLOSED", ctx);
    expect(result.success).toBe(true);
    expect(extendForPatient).not.toHaveBeenCalled();
  });
});

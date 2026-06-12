import { beforeEach, describe, expect, it, vi } from "vitest";
import { billingService } from "@/services/billingService";
import { billingRepository } from "@/database/billingRepository";

vi.mock("@/database/billingRepository");
vi.mock("@/database/patientRepository");
vi.mock("@/database/dutyRepository");
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "acct@test.com", accessToken: "tok" } };

describe("billingService optimistic concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns conflict when sec_dep PATCH carries a stale expected_updated_at", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: {
        id: "B1",
        status: "Active",
        updated_at: "2026-06-01T12:00:00.000Z",
        sec_dep: 1000
      }
    });

    const result = await billingService.update(
      "B1",
      { sec_dep: 2000, expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(billingRepository.updateBilling).not.toHaveBeenCalled();
  });

  it("allows sec_dep PATCH when expected_updated_at matches", async () => {
    const updatedAt = "2026-06-01T12:00:00.000Z";
    vi.mocked(billingRepository.findBillingById)
      .mockResolvedValueOnce({
        success: true,
        data: { id: "B1", status: "Active", updated_at: updatedAt, sec_dep: 1000 }
      })
      .mockResolvedValueOnce({
        success: true,
        data: { id: "B1", status: "Active", updated_at: updatedAt, sec_dep: 2000 }
      });
    vi.mocked(billingRepository.updateBilling).mockResolvedValue({
      success: true,
      data: { id: "B1", status: "Active", updated_at: updatedAt, sec_dep: 2000 }
    });

    const result = await billingService.update(
      "B1",
      { sec_dep: 2000, expected_updated_at: updatedAt },
      ctx
    );

    expect(result.success).toBe(true);
    expect(billingRepository.updateBilling).toHaveBeenCalled();
  });

  it("returns conflict on setStatus when expected_updated_at is stale", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: {
        id: "B1",
        status: "Active",
        updated_at: "2026-06-01T12:00:00.000Z"
      }
    });

    const result = await billingService.setStatus(
      "B1",
      { status: "Paused", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(billingRepository.updateBilling).not.toHaveBeenCalled();
  });

  it("returns conflict on close when expected_updated_at is stale", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: {
        id: "B1",
        status: "Active",
        updated_at: "2026-06-01T12:00:00.000Z",
        patient_id: "P1"
      }
    });

    const result = await billingService.close(
      "B1",
      { reason: "Done", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(billingRepository.flipBillingStatusRpc).not.toHaveBeenCalled();
  });

  it("returns conflict on reopen when expected_updated_at is stale", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: {
        id: "B1",
        status: "Closed",
        updated_at: "2026-06-01T12:00:00.000Z",
        patient_id: "P1"
      }
    });

    const result = await billingService.reopen(
      "B1",
      { reason: "Reopen for billing", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(billingRepository.flipBillingStatusRpc).not.toHaveBeenCalled();
  });
});

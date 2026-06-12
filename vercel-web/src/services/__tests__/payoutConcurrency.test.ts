import { beforeEach, describe, expect, it, vi } from "vitest";
import { payoutService } from "@/services/payoutService";
import { payoutRepository } from "@/database/payoutRepository";

vi.mock("@/database/payoutRepository");
vi.mock("@/database/dutyRepository");
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "pay@test.com", accessToken: "tok" } };

describe("payoutService optimistic concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns conflict when adjust carries a stale expected_updated_at", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: {
        id: "P1",
        status: "OPEN",
        updated_at: "2026-06-01T12:00:00.000Z",
        gross_amount: 1000,
        advance: 0,
        deduction: 0,
        bonus: 0,
        remarks: ""
      }
    });

    const result = await payoutService.adjust(
      {
        payout_id: "P1",
        advance: 100,
        expected_updated_at: "2020-01-01T00:00:00.000Z"
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(payoutRepository.update).not.toHaveBeenCalled();
  });

  it("allows adjust when expected_updated_at matches", async () => {
    const updatedAt = "2026-06-01T12:00:00.000Z";
    vi.mocked(payoutRepository.findById)
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "P1",
          status: "OPEN",
          updated_at: updatedAt,
          gross_amount: 1000,
          advance: 0,
          deduction: 0,
          bonus: 0,
          remarks: ""
        }
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: "P1",
          status: "OPEN",
          updated_at: updatedAt,
          gross_amount: 1000,
          advance: 100,
          deduction: 0,
          bonus: 0,
          remarks: ""
        }
      });
    vi.mocked(payoutRepository.update).mockResolvedValue({
      success: true,
      data: { id: "P1", status: "OPEN", updated_at: updatedAt, advance: 100 }
    });

    const result = await payoutService.adjust(
      {
        payout_id: "P1",
        advance: 100,
        expected_updated_at: updatedAt
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(payoutRepository.update).toHaveBeenCalled();
  });

  it("returns conflict on lock when expected_updated_at is stale", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: {
        id: "P1",
        status: "OPEN",
        updated_at: "2026-06-01T12:00:00.000Z",
        net_amount: 1000,
        duty_count: 1
      }
    });

    const result = await payoutService.lock(
      "P1",
      { reason: "Ready to pay", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(payoutRepository.update).not.toHaveBeenCalled();
  });

  it("returns conflict on reopen when expected_updated_at is stale", async () => {
    vi.mocked(payoutRepository.findById).mockResolvedValue({
      success: true,
      data: {
        id: "P1",
        status: "LOCKED",
        updated_at: "2026-06-01T12:00:00.000Z"
      }
    });

    const result = await payoutService.reopen(
      "P1",
      { reason: "Fix rates", expected_updated_at: "2020-01-01T00:00:00.000Z" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(payoutRepository.update).not.toHaveBeenCalled();
  });
});

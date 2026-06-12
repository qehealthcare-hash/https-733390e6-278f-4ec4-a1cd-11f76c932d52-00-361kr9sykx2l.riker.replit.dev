/**
 * Payout module smoke — HTTP coverage for lock / reopen / pay / adjust
 * optimistic-lock paths (QA_SIGNOFF financial § payouts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/mutationAudit", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildMutationAuditMock();
});
vi.mock("@/services/payoutService", () => ({
  payoutService: {
    adjust: vi.fn(),
    lock: vi.fn(),
    reopen: vi.fn(),
    markPaid: vi.fn(),
    payAdvance: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectErrorEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { payoutService } from "@/services/payoutService";
import { POST as PayoutAdjustPost } from "../../../app/api/v1/payouts/adjust/route";
import { POST as PayoutLockPost } from "../../../app/api/v1/payouts/[id]/lock/route";
import { POST as PayoutReopenPost } from "../../../app/api/v1/payouts/[id]/reopen/route";
import { POST as PayoutPayPost } from "../../../app/api/v1/payouts/pay/route";

const m = payoutService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const VERSION = "2026-06-01T12:00:00.000Z";

describe("Payout module smoke — optimistic concurrency at HTTP layer", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("POST /payouts/adjust forwards expected_updated_at and surfaces 409", async () => {
    setActor(ACTORS.accountant);
    m.adjust.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Payout was modified by another user"
    });
    const req = makeRequest("POST", "/api/v1/payouts/adjust", {
      body: {
        payout_id: "PAY1",
        bonus: 100,
        expected_updated_at: VERSION
      }
    });
    const res = await PayoutAdjustPost(req, ctx({}));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.adjust).toHaveBeenCalledWith(
      expect.objectContaining({ expected_updated_at: VERSION }),
      expect.any(Object)
    );
  });

  it("POST /payouts/[id]/lock forwards expected_updated_at and surfaces 409", async () => {
    setActor(ACTORS.accountant);
    m.lock.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Payout was modified by another user"
    });
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/lock", {
      body: { reason: "Ready", expected_updated_at: VERSION }
    });
    const res = await PayoutLockPost(req, ctx({ id: "PAY1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.lock).toHaveBeenCalledWith(
      "PAY1",
      { reason: "Ready", expected_updated_at: VERSION },
      expect.any(Object)
    );
  });

  it("POST /payouts/[id]/reopen forwards expected_updated_at and surfaces 409", async () => {
    setActor(ACTORS.admin);
    m.reopen.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Payout was modified by another user"
    });
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/reopen", {
      body: { reason: "Correction", expected_updated_at: VERSION }
    });
    const res = await PayoutReopenPost(req, ctx({ id: "PAY1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.reopen).toHaveBeenCalledWith(
      "PAY1",
      { reason: "Correction", expected_updated_at: VERSION },
      expect.any(Object)
    );
  });

  it("POST /payouts/pay forwards expected_updated_at and surfaces 409", async () => {
    setActor(ACTORS.accountant);
    m.markPaid.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Payout was modified by another user"
    });
    const req = makeRequest("POST", "/api/v1/payouts/pay", {
      body: {
        payout_id: "PAY1",
        proof_bucket: "payout-proofs",
        proof_path: "proofs/x.jpg",
        expected_updated_at: VERSION
      }
    });
    const res = await PayoutPayPost(req, ctx({}));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.markPaid).toHaveBeenCalledWith(
      expect.objectContaining({ expected_updated_at: VERSION }),
      expect.any(Object)
    );
  });
});

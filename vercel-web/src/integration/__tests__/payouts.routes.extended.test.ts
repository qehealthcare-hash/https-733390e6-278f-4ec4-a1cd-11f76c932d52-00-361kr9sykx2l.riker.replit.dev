/**
 * Integration test: payout routes not fully covered by payouts.route.test.ts
 * (M9 Pass A): GET [id], POST adjust, POST reopen.
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
    getById: vi.fn(),
    adjust: vi.fn(),
    reopen: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { payoutService } from "@/services/payoutService";
import { payoutDetailFixture } from "@/test/payoutDetailFixture";

import { GET as PayoutByIdGet } from "../../../app/api/v1/payouts/[id]/route";
import { POST as PayoutAdjustPost } from "../../../app/api/v1/payouts/adjust/route";
import { POST as PayoutReopenPost } from "../../../app/api/v1/payouts/[id]/reopen/route";

const m = payoutService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const minimalPayoutRow = {
  id: "PAY1",
  employee_id: "EMP1",
  period_month: "2026-05",
  status: "OPEN" as const
};

describe("GET /api/v1/payouts/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("allows Nurse (payouts.read)", async () => {
    setActor(ACTORS.nurse);
    m.getById.mockResolvedValue({
      success: true,
      data: payoutDetailFixture()
    });
    const req = makeRequest("GET", "/api/v1/payouts/PAY1");
    const res = await PayoutByIdGet(req, ctx({ id: "PAY1" }));
    await expectOkEnvelope(res);
    expect(m.getById).toHaveBeenCalledWith("PAY1", expect.any(Object));
  });

  it("denies unauthenticated", async () => {
    const req = makeRequest("GET", "/api/v1/payouts/PAY1", { noAuth: true });
    const res = await PayoutByIdGet(req, ctx({ id: "PAY1" }));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });
});

describe("POST /api/v1/payouts/adjust", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Manager (pay tier only)", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/payouts/adjust", {
      body: { payout_id: "PAY1", advance: 100 }
    });
    const res = await PayoutAdjustPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.adjust).not.toHaveBeenCalled();
  });

  it("adjusts for Accountant", async () => {
    setActor(ACTORS.accountant);
    m.adjust.mockResolvedValue({ success: true, data: minimalPayoutRow });
    const req = makeRequest("POST", "/api/v1/payouts/adjust", {
      body: { payout_id: "PAY1", advance: 200, deduction: 0, bonus: 0 }
    });
    const res = await PayoutAdjustPost(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.adjust).toHaveBeenCalled();
  });
});

describe("POST /api/v1/payouts/[id]/reopen", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Manager", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/reopen", {
      body: { reason: "Correction" }
    });
    const res = await PayoutReopenPost(req, ctx({ id: "PAY1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.reopen).not.toHaveBeenCalled();
  });

  it("reopens for Admin", async () => {
    setActor(ACTORS.admin);
    m.reopen.mockResolvedValue({ success: true, data: minimalPayoutRow });
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/reopen", {
      body: { reason: "Rate correction" }
    });
    const res = await PayoutReopenPost(req, ctx({ id: "PAY1" }));
    await expectOkEnvelope(res);
    expect(m.reopen).toHaveBeenCalledWith(
      "PAY1",
      { reason: "Rate correction" },
      expect.any(Object)
    );
  });
});

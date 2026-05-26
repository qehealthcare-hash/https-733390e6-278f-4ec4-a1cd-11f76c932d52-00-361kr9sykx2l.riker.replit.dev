/**
 * Integration test: payout API surface.
 *
 * - GET /payouts: any authed actor (filters threaded).
 * - POST /payouts: Admin/Manager/Accountant only.
 * - POST /payouts/[id]/recompute: Accountant tier.
 * - POST /payouts/[id]/lock.
 * - POST /payouts/pay: Admin/Accountant only.
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
    list: vi.fn(),
    ensure: vi.fn(),
    getById: vi.fn(),
    recompute: vi.fn(),
    lock: vi.fn(),
    markPaid: vi.fn(),
    payAdvance: vi.fn(),
    pendingForEmployeePeriod: vi.fn(),
    pendingEmployeesForPeriod: vi.fn(),
    setEmployeePeriodPayoutRate: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { payoutService } from "@/services/payoutService";

import {
  GET as PayoutsGet,
  POST as PayoutsPost
} from "../../../app/api/v1/payouts/route";
import { POST as PayoutRecompute } from "../../../app/api/v1/payouts/[id]/recompute/route";
import { POST as PayoutLock } from "../../../app/api/v1/payouts/[id]/lock/route";
import { POST as PayoutPay } from "../../../app/api/v1/payouts/pay/route";
import { POST as PayoutPayAdvance } from "../../../app/api/v1/payouts/[id]/pay-advance/route";
import { GET as PayoutPending } from "../../../app/api/v1/payouts/pending/route";
import { GET as PayoutPendingEmployees } from "../../../app/api/v1/payouts/pending-employees/route";
import { POST as PayoutSetRate } from "../../../app/api/v1/payouts/set-rate/route";

const m = payoutService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/payouts", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    const req = makeRequest("GET", "/api/v1/payouts", { noAuth: true });
    const res = await PayoutsGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("denies anonymous list", async () => {
    setActor(null);
    const req = makeRequest("GET", "/api/v1/payouts", { noAuth: true });
    const res = await PayoutsGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("forwards period and employee filters", async () => {
    setActor(ACTORS.manager);
    m.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest(
      "GET",
      "/api/v1/payouts?period=2026-05&employee_id=EMP1&status=Pending"
    );
    const res = await PayoutsGet(req, ctx({}));
    await expectOkEnvelope(res);
    const [query] = m.list.mock.calls[0];
    expect(query).toMatchObject({
      period: "2026-05",
      employee_id: "EMP1",
      status: "Pending"
    });
  });
});

describe("POST /api/v1/payouts", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/payouts", {
      body: { employee_id: "EMP1", period_month: "2026-05" }
    });
    const res = await PayoutsPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it("creates a payout for Accountant", async () => {
    setActor(ACTORS.accountant);
    m.ensure.mockResolvedValue({ success: true, data: { id: "PAY1" } });
    const req = makeRequest("POST", "/api/v1/payouts", {
      body: { employee_id: "EMP1", period_month: "2026-05" }
    });
    const res = await PayoutsPost(req, ctx({}));
    const data = await expectCreatedEnvelope<{ id: string }>(res);
    expect(data.id).toBe("PAY1");
  });
});

describe("POST /api/v1/payouts/[id]/recompute", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/recompute");
    const res = await PayoutRecompute(req, ctx({ id: "PAY1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
  });

  it("propagates not_found from payoutService.getById", async () => {
    setActor(ACTORS.accountant);
    m.getById.mockResolvedValue({
      success: false,
      code: "not_found",
      error: "Payout not found"
    });
    const req = makeRequest("POST", "/api/v1/payouts/MISSING/recompute");
    const res = await PayoutRecompute(req, ctx({ id: "MISSING" }));
    await expectErrorEnvelope(res, 404, "not_found");
    expect(m.recompute).not.toHaveBeenCalled();
  });

  it("recomputes when payout is found", async () => {
    setActor(ACTORS.admin);
    m.getById.mockResolvedValue({
      success: true,
      data: { payout: { employee_id: "EMP1", period_month: "2026-05" } }
    });
    m.recompute.mockResolvedValue({ success: true, data: { recomputed: true } });
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/recompute");
    const res = await PayoutRecompute(req, ctx({ id: "PAY1" }));
    await expectOkEnvelope(res);
    expect(m.recompute).toHaveBeenCalledWith(
      { employee_id: "EMP1", period_month: "2026-05" },
      expect.any(Object)
    );
  });
});

describe("POST /api/v1/payouts/[id]/lock", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("locks when authorised", async () => {
    setActor(ACTORS.manager);
    m.lock.mockResolvedValue({ success: true, data: { id: "PAY1", status: "Locked" } });
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/lock", { body: {} });
    const res = await PayoutLock(req, ctx({ id: "PAY1" }));
    await expectOkEnvelope(res);
  });
});

describe("POST /api/v1/payouts/pay", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("only Admin/Accountant may pay", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/payouts/pay", {
      body: { payout_id: "PAY1", amount: 1000 }
    });
    const res = await PayoutPay(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.markPaid).not.toHaveBeenCalled();
  });

  it("pays when Accountant", async () => {
    setActor(ACTORS.accountant);
    m.markPaid.mockResolvedValue({ success: true, data: { id: "PAY1", status: "Paid" } });
    const req = makeRequest("POST", "/api/v1/payouts/pay", {
      body: { payout_id: "PAY1", amount: 1000 }
    });
    const res = await PayoutPay(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.markPaid).toHaveBeenCalled();
  });

  it("propagates business failure when proof is missing", async () => {
    setActor(ACTORS.accountant);
    m.markPaid.mockResolvedValue({
      success: false,
      code: "business_rule_violation",
      error: "Payout proof is required — upload a receipt/photo before marking paid"
    });
    const req = makeRequest("POST", "/api/v1/payouts/pay", {
      body: { payout_id: "PAY1", amount: 1000 }
    });
    const res = await PayoutPay(req, ctx({}));
    await expectErrorEnvelope(res, 422, "business_rule_violation");
  });
});

describe("POST /api/v1/payouts/[id]/pay-advance", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Manager (Admin/Accountant tier only)", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/pay-advance", {
      body: {
        amount: 500,
        proof_bucket: "payout-proofs",
        proof_path: "2026-05/abc.pdf"
      }
    });
    const res = await PayoutPayAdvance(req, ctx({ id: "PAY1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.payAdvance).not.toHaveBeenCalled();
  });

  it("records advance for Accountant and forwards id", async () => {
    setActor(ACTORS.accountant);
    m.payAdvance.mockResolvedValue({
      success: true,
      data: { id: "PAY1", status: "OPEN" }
    });
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/pay-advance", {
      body: {
        amount: 500,
        proof_bucket: "payout-proofs",
        proof_path: "2026-05/abc.pdf"
      }
    });
    const res = await PayoutPayAdvance(req, ctx({ id: "PAY1" }));
    await expectOkEnvelope(res);
    expect(m.payAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        payout_id: "PAY1",
        amount: 500,
        proof_bucket: "payout-proofs",
        proof_path: "2026-05/abc.pdf"
      }),
      expect.any(Object)
    );
  });

  it("propagates over-pay business failure", async () => {
    setActor(ACTORS.accountant);
    m.payAdvance.mockResolvedValue({
      success: false,
      code: "business_rule_violation",
      error: "Disbursement ₹2000.00 exceeds remaining outstanding ₹500.00"
    });
    const req = makeRequest("POST", "/api/v1/payouts/PAY1/pay-advance", {
      body: { amount: 2000, proof_bucket: "payout-proofs", proof_path: "x" }
    });
    const res = await PayoutPayAdvance(req, ctx({ id: "PAY1" }));
    await expectErrorEnvelope(res, 422, "business_rule_violation");
  });
});

describe("GET /api/v1/payouts/pending", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    const req = makeRequest("GET", "/api/v1/payouts/pending?employee_id=E1&period=2026-05", {
      noAuth: true
    });
    const res = await PayoutPending(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("forwards employee_id + period and returns the pending envelope", async () => {
    setActor(ACTORS.staff);
    m.pendingForEmployeePeriod.mockResolvedValue({
      success: true,
      data: {
        employee_id: "EMP1",
        employee_name: "Manisha Asari",
        period: "2026-05",
        charged: 12000,
        paid: 5000,
        pending: 7000,
        duty_count: 24,
        payout: null,
        paid_transactions: []
      }
    });
    const req = makeRequest(
      "GET",
      "/api/v1/payouts/pending?employee_id=EMP1&period=2026-05"
    );
    const res = await PayoutPending(req, ctx({}));
    const body = await expectOkEnvelope<{ pending: number; employee_name: string }>(res);
    expect(body.pending).toBe(7000);
    expect(body.employee_name).toBe("Manisha Asari");
    expect(m.pendingForEmployeePeriod).toHaveBeenCalledWith(
      { employee_id: "EMP1", period: "2026-05" },
      expect.any(Object)
    );
  });
});

describe("GET /api/v1/payouts/pending-employees", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    const req = makeRequest("GET", "/api/v1/payouts/pending-employees?period=2026-05", {
      noAuth: true
    });
    const res = await PayoutPendingEmployees(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("returns the unpaid-employees envelope for an authed reader", async () => {
    setActor(ACTORS.accountant);
    m.pendingEmployeesForPeriod.mockResolvedValue({
      success: true,
      data: {
        period: "2026-05",
        total_pending: 14500,
        rows: [
          {
            employee_id: "EMP1",
            employee_name: "Manisha Asari",
            charged: 12000,
            paid: 4000,
            pending: 8000,
            duty_count: 24,
            payout_id: "PAY1",
            payout_status: "LOCKED"
          },
          {
            employee_id: "EMP2",
            employee_name: "Rakesh Kumar",
            charged: 6500,
            paid: 0,
            pending: 6500,
            duty_count: 13,
            payout_id: null,
            payout_status: null
          }
        ]
      }
    });
    const req = makeRequest(
      "GET",
      "/api/v1/payouts/pending-employees?period=2026-05"
    );
    const res = await PayoutPendingEmployees(req, ctx({}));
    const body = await expectOkEnvelope<{
      total_pending: number;
      rows: Array<{ employee_name: string; payout_id: string | null }>;
    }>(res);
    expect(body.total_pending).toBe(14500);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].employee_name).toBe("Manisha Asari");
    expect(body.rows[1].payout_id).toBeNull();
    expect(m.pendingEmployeesForPeriod).toHaveBeenCalledWith(
      { period: "2026-05" },
      expect.any(Object)
    );
  });
});

describe("POST /api/v1/payouts/set-rate", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse (read-only role)", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/payouts/set-rate", {
      body: { employee_id: "EMP1", period: "2026-05", payout_per_day: 800 }
    });
    const res = await PayoutSetRate(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.setEmployeePeriodPayoutRate).not.toHaveBeenCalled();
  });

  it("propagates validation failure for non-positive rate", async () => {
    setActor(ACTORS.accountant);
    m.setEmployeePeriodPayoutRate.mockResolvedValue({
      success: false,
      code: "validation_error",
      error: "payout_per_day must be a positive number"
    });
    const req = makeRequest("POST", "/api/v1/payouts/set-rate", {
      body: { employee_id: "EMP1", period: "2026-05", payout_per_day: 0 }
    });
    const res = await PayoutSetRate(req, ctx({}));
    await expectErrorEnvelope(res, 422, "validation_error");
  });

  it("returns the refreshed PayoutDetail envelope for Accountant", async () => {
    setActor(ACTORS.accountant);
    m.setEmployeePeriodPayoutRate.mockResolvedValue({
      success: true,
      data: {
        payout: { id: "PAY1", gross_amount: 1600, net_amount: 1600 },
        diagnostics: { duties_needing_rate: [], warning: "" }
      }
    });
    const req = makeRequest("POST", "/api/v1/payouts/set-rate", {
      body: { employee_id: "EMP1", period: "2026-05", payout_per_day: 800 }
    });
    const res = await PayoutSetRate(req, ctx({}));
    const body = await expectOkEnvelope<{ payout: { gross_amount: number } }>(res);
    expect(body.payout.gross_amount).toBe(1600);
    expect(m.setEmployeePeriodPayoutRate).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: "EMP1", period: "2026-05", payout_per_day: 800 }),
      expect.any(Object)
    );
  });
});

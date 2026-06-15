/**
 * Billing module smoke — automated coverage for QA_SIGNOFF.md § Financial.
 *
 * Maps operator-critical billing HTTP paths (optimistic lock, close, reopen)
 * to route-handler tests so refactors cannot drop `expected_updated_at` wiring.
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
vi.mock("@/services/billingService", () => ({
  billingService: {
    update: vi.fn(),
    setStatus: vi.fn(),
    close: vi.fn(),
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
import { billingService } from "@/services/billingService";
import { billingSummaryFixture } from "@/test/billingSummaryFixture";
import { PATCH as BillingPatch } from "../../../app/api/v1/billings/[id]/route";
import { POST as BillingStatusPost } from "../../../app/api/v1/billings/[id]/status/route";
import { POST as BillingClosePost } from "../../../app/api/v1/billings/[id]/close/route";
import { POST as BillingReopenPost } from "../../../app/api/v1/billings/[id]/reopen/route";

const m = billingService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const VERSION = "2026-06-01T12:00:00.000Z";

const minimalBillingRow = {
  id: "BILL1",
  patient_id: "PAT1",
  status: "Active" as const
};

describe("Billing module smoke — optimistic concurrency at HTTP layer", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("PATCH /billings/[id] forwards expected_updated_at and surfaces 409 conflict", async () => {
    setActor(ACTORS.accountant);
    m.update.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Billing was modified by another user — reload and try again"
    });
    const req = makeRequest("PATCH", "/api/v1/billings/BILL1", {
      body: { sec_dep: 5000, expected_updated_at: VERSION }
    });
    const res = await BillingPatch(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.update).toHaveBeenCalledWith(
      "BILL1",
      { sec_dep: 5000, expected_updated_at: VERSION },
      expect.any(Object)
    );
  });

  it("POST /billings/[id]/status forwards expected_updated_at and surfaces 409 conflict", async () => {
    setActor(ACTORS.accountant);
    m.setStatus.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Billing was modified by another user — reload and try again"
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/status", {
      body: { status: "Paused", expected_updated_at: VERSION }
    });
    const res = await BillingStatusPost(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.setStatus).toHaveBeenCalledWith(
      "BILL1",
      { status: "Paused", expected_updated_at: VERSION },
      expect.any(Object)
    );
  });

  it("POST /billings/[id]/close forwards expected_updated_at and surfaces 409 conflict", async () => {
    setActor(ACTORS.manager);
    m.close.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Billing was modified by another user — reload and try again"
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/close", {
      body: { reason: "Month end", expected_updated_at: VERSION }
    });
    const res = await BillingClosePost(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.close).toHaveBeenCalledWith(
      "BILL1",
      { reason: "Month end", expected_updated_at: VERSION },
      expect.any(Object)
    );
  });

  it("POST /billings/[id]/reopen forwards expected_updated_at and surfaces 409 conflict", async () => {
    setActor(ACTORS.manager);
    m.reopen.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Billing was modified by another user — reload and try again"
    });
    const req = makeRequest("POST", "/api/v1/billings/BILL1/reopen", {
      body: { reason: "Correction", expected_updated_at: VERSION }
    });
    const res = await BillingReopenPost(req, ctx({ id: "BILL1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.reopen).toHaveBeenCalledWith(
      "BILL1",
      { reason: "Correction", expected_updated_at: VERSION },
      expect.any(Object)
    );
  });
});

describe("Billing module smoke — RBAC on lifecycle mutations", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff from PATCH, status change, close, and reopen", async () => {
    setActor(ACTORS.staff);
    const patchRes = await BillingPatch(
      makeRequest("PATCH", "/api/v1/billings/BILL1", { body: { sec_dep: 1 } }),
      ctx({ id: "BILL1" })
    );
    await expectErrorEnvelope(patchRes, 403, "forbidden");

    const statusRes = await BillingStatusPost(
      makeRequest("POST", "/api/v1/billings/BILL1/status", { body: { status: "Paused" } }),
      ctx({ id: "BILL1" })
    );
    await expectErrorEnvelope(statusRes, 403, "forbidden");

    const closeRes = await BillingClosePost(
      makeRequest("POST", "/api/v1/billings/BILL1/close", { body: { reason: "x" } }),
      ctx({ id: "BILL1" })
    );
    await expectErrorEnvelope(closeRes, 403, "forbidden");

    const reopenRes = await BillingReopenPost(
      makeRequest("POST", "/api/v1/billings/BILL1/reopen", { body: { reason: "x" } }),
      ctx({ id: "BILL1" })
    );
    await expectErrorEnvelope(reopenRes, 403, "forbidden");

    expect(m.update).not.toHaveBeenCalled();
    expect(m.setStatus).not.toHaveBeenCalled();
    expect(m.close).not.toHaveBeenCalled();
    expect(m.reopen).not.toHaveBeenCalled();
  });

  it("permits Accountant PATCH then Manager close with version token", async () => {
    setActor(ACTORS.accountant);
    m.update.mockResolvedValue({
      success: true,
      data: { ...minimalBillingRow, updated_at: VERSION, sec_dep: 2000 }
    });
    const patchRes = await BillingPatch(
      makeRequest("PATCH", "/api/v1/billings/BILL1", {
        body: { sec_dep: 2000, expected_updated_at: VERSION }
      }),
      ctx({ id: "BILL1" })
    );
    await expectOkEnvelope(patchRes);

    setActor(ACTORS.manager);
    m.close.mockResolvedValue({
      success: true,
      data: billingSummaryFixture({
        billing: { id: "BILL1", patient_id: "PAT1", status: "Closed" }
      })
    });
    const closeRes = await BillingClosePost(
      makeRequest("POST", "/api/v1/billings/BILL1/close", {
        body: { reason: "Settled", expected_updated_at: VERSION }
      }),
      ctx({ id: "BILL1" })
    );
    await expectOkEnvelope(closeRes);
    expect(m.close).toHaveBeenCalledWith(
      "BILL1",
      { reason: "Settled", expected_updated_at: VERSION },
      expect.any(Object)
    );
  });
});

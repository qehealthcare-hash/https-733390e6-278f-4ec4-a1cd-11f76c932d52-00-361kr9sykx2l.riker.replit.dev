/**
 * Integration test: dashboard KPI route. (M3-M6)
 *
 * Covers:
 *   - Auth/role gate (`DASHBOARD_READ_ROLES` includes everyone but a
 *     non-canonical role; rbac.drift.test.ts already pins the literal).
 *   - Validation of the `period` query string (route hands it to the
 *     service which uses `dashboardQuerySchema`).
 *   - The actor envelope reaches the service unchanged.
 *   - The KPI response is wrapped in the canonical `{ success, data }`
 *     envelope with the expected fields (so the dashboard page can
 *     trust them).
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
vi.mock("@/services/reportService", () => ({
  reportService: {
    dashboard: vi.fn()
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
import { reportService } from "@/services/reportService";

import { GET as DashboardGet } from "../../../app/api/v1/reports/dashboard/route";

const m = reportService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const FIXTURE_KPIS = {
  period: "2026-05",
  range: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
  patients_total: 10,
  patients_active: 7,
  employees_total: 5,
  employees_active: 4,
  inquiries_this_month: 3,
  duties_active: 2,
  duties_scheduled: 1,
  duties_completed: 8,
  duties_cancelled: 1,
  billings_total: 9,
  billings_open: 6,
  billings_closed: 3,
  billing_total_amount: 1500,
  billing_collected_amount: 1200,
  billing_pending_amount: 300,
  payout_total_amount: 1000,
  payout_gross_amount: 1150,
  payout_paid_amount: 800,
  payout_pending_amount: 350,
  partner_charge_ledger: 150,
  profit_loss: 400,
  profit_loss_after_pending: 50
};

describe("GET /api/v1/reports/dashboard", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("returns the KPI envelope for an authorised actor (Admin)", async () => {
    setActor(ACTORS.admin);
    m.dashboard.mockResolvedValue({ success: true, data: FIXTURE_KPIS });

    const req = makeRequest("GET", "/api/v1/reports/dashboard?period=2026-05");
    const res = await DashboardGet(req, ctx({}));
    const data = await expectOkEnvelope<typeof FIXTURE_KPIS>(res);

    expect(data.period).toBe("2026-05");
    expect(data.billing_collected_amount).toBe(1200);
    expect(data.profit_loss).toBe(400);
    expect(data.profit_loss_after_pending).toBe(50);
  });

  it("forwards the actor envelope and parsed query to reportService.dashboard", async () => {
    setActor(ACTORS.manager);
    m.dashboard.mockResolvedValue({ success: true, data: FIXTURE_KPIS });

    const req = makeRequest(
      "GET",
      "/api/v1/reports/dashboard?period=2026-05&patient_id=PAT1"
    );
    await DashboardGet(req, ctx({}));

    expect(m.dashboard).toHaveBeenCalledTimes(1);
    const [query, context] = m.dashboard.mock.calls[0];
    expect(query.period).toBe("2026-05");
    expect(query.patient_id).toBe("PAT1");
    expect(context.actor.email).toBe("manager@hominal.test");
  });

  it("denies an unknown role with 403", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest("GET", "/api/v1/reports/dashboard?period=2026-05");
    const res = await DashboardGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.dashboard).not.toHaveBeenCalled();
  });

  it("returns 401 when no actor is set (anonymous)", async () => {
    const req = makeRequest("GET", "/api/v1/reports/dashboard?period=2026-05");
    const res = await DashboardGet(req, ctx({}));
    expect(res.status).toBe(401);
    expect(m.dashboard).not.toHaveBeenCalled();
  });

  it("surfaces a service failure as a structured error envelope", async () => {
    setActor(ACTORS.admin);
    m.dashboard.mockResolvedValue({
      success: false,
      code: "validation_error",
      error: "Invalid period"
    });

    const req = makeRequest("GET", "/api/v1/reports/dashboard?period=bogus");
    const res = await DashboardGet(req, ctx({}));
    await expectErrorEnvelope(res, 422, "validation_error");
  });

  it("permits the broad reader cohort (Nurse, Supervisor, Accountant, Staff, Executive)", async () => {
    m.dashboard.mockResolvedValue({ success: true, data: FIXTURE_KPIS });

    for (const actor of [
      ACTORS.nurse,
      ACTORS.staff,
      ACTORS.accountant
      // Supervisor + Executive fixtures aren't in the harness yet (queued
      // as M2-M3); when they land, append them here. The drift-guard
      // test already enforces the canonical role set on the route side.
    ]) {
      setActor(actor);
      const req = makeRequest("GET", "/api/v1/reports/dashboard?period=2026-05");
      const res = await DashboardGet(req, ctx({}));
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    }
  });
});

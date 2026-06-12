/**
 * Integration test: report routes not covered by reportsSummaries.route.test.ts
 * (M10 Pass A): billing-totals, payout-totals, profit-loss, payroll.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/reportService", () => ({
  reportService: {
    billingTotals: vi.fn(),
    payoutTotals: vi.fn(),
    profitLoss: vi.fn(),
    payroll: vi.fn(),
    reconciliation: vi.fn()
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

import { GET as BillingTotalsGet } from "../../../app/api/v1/reports/billing-totals/route";
import { GET as PayoutTotalsGet } from "../../../app/api/v1/reports/payout-totals/route";
import { GET as ProfitLossGet } from "../../../app/api/v1/reports/profit-loss/route";
import { GET as PayrollGet } from "../../../app/api/v1/reports/payroll/route";
import { GET as ReconciliationGet } from "../../../app/api/v1/reports/reconciliation/route";

const m = reportService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/reports/billing-totals", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("allows Executive (reports.read parity, M10)", async () => {
    setActor({ ...ACTORS.staff, role: "Executive", email: "executive@hominal.test" });
    m.billingTotals.mockResolvedValue({
      success: true,
      data: { period: "2026-05", service_total: 1000 }
    });
    const req = makeRequest("GET", "/api/v1/reports/billing-totals?period=2026-05");
    const res = await BillingTotalsGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.billingTotals).toHaveBeenCalled();
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("GET", "/api/v1/reports/billing-totals?period=2026-05");
    const res = await BillingTotalsGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.billingTotals).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/reports/payout-totals", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("returns totals for Accountant", async () => {
    setActor(ACTORS.accountant);
    m.payoutTotals.mockResolvedValue({
      success: true,
      data: { period: "2026-05", gross: 5000, net: 4500 }
    });
    const req = makeRequest("GET", "/api/v1/reports/payout-totals?period=2026-05");
    const res = await PayoutTotalsGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.payoutTotals).toHaveBeenCalledWith(
      expect.objectContaining({ period: "2026-05" }),
      expect.any(Object)
    );
  });
});

describe("GET /api/v1/reports/profit-loss", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("returns profit-loss for Manager", async () => {
    setActor(ACTORS.manager);
    m.profitLoss.mockResolvedValue({
      success: true,
      data: { period: "2026-05", revenue: 10000, net_profit: 2000 }
    });
    const req = makeRequest("GET", "/api/v1/reports/profit-loss?period=2026-05");
    const res = await ProfitLossGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.profitLoss).toHaveBeenCalled();
  });
});

describe("GET /api/v1/reports/payroll", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("GET", "/api/v1/reports/payroll?period=2026-05");
    const res = await PayrollGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.payroll).not.toHaveBeenCalled();
  });

  it("returns payroll rows for Admin", async () => {
    setActor(ACTORS.admin);
    m.payroll.mockResolvedValue({
      success: true,
      data: { period: "2026-05", rows: [{ employee_id: "EMP1" }] }
    });
    const req = makeRequest("GET", "/api/v1/reports/payroll?period=2026-05");
    const res = await PayrollGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.payroll).toHaveBeenCalled();
  });
});

describe("GET /api/v1/reports/reconciliation", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("returns duty-master synchronization audit for Admin", async () => {
    setActor(ACTORS.admin);
    m.reconciliation.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        from: "2026-05-01",
        to: "2026-05-31",
        summary: {
          expected_duty_day_rows: 40,
          missing_service_rows: 0,
          missing_payout_rows: 0,
          duplicate_service_groups: 0,
          duplicate_payout_groups: 0
        }
      }
    });

    const req = makeRequest("GET", "/api/v1/reports/reconciliation?period=2026-05");
    const res = await ReconciliationGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.reconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ period: "2026-05" }),
      expect.objectContaining({ actor: expect.objectContaining({ email: "admin@hominal.test" }) })
    );
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("GET", "/api/v1/reports/reconciliation?period=2026-05");
    const res = await ReconciliationGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.reconciliation).not.toHaveBeenCalled();
  });
});

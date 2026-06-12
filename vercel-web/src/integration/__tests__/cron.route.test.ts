/**
 * Integration test: GET /api/v1/cron/duties-extend
 *
 * Verifies the cron-secret gating that fail-closes in production, and
 * the success path that proxies through dutyService.bulkExtendDue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/mutationAudit", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildMutationAuditMock();
});
vi.mock("@/services/dutyService", () => ({
  dutyService: {
    extendActive: vi.fn(),
    extendDue: vi.fn(),
    bulkExtendDue: vi.fn(),
    syncDutyAttendancePayoutLedger: vi.fn()
  }
}));

import {
  ctx,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  resetIdempotencyStore
} from "@/test/routeHarness";
import { dutyService } from "@/services/dutyService";
import { GET as CronGet } from "../../../app/api/v1/cron/duties-extend/route";

const m = dutyService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/cron/duties-extend", () => {
  const origSecret = process.env.CRON_SECRET;
  const origLegacy = process.env.DUTY_CRON_SECRET;
  const origVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    resetIdempotencyStore();
  });

  afterEach(() => {
    process.env.CRON_SECRET = origSecret;
    process.env.DUTY_CRON_SECRET = origLegacy;
    process.env.VERCEL_ENV = origVercelEnv;
  });

  it("refuses with 500 in production when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DUTY_CRON_SECRET;
    process.env.VERCEL_ENV = "production";
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", { noAuth: true });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 500, "internal_error");
    expect(m.bulkExtendDue).not.toHaveBeenCalled();
    expect(m.syncDutyAttendancePayoutLedger).not.toHaveBeenCalled();
  });

  it("refuses with 500 in preview / dev when CRON_SECRET is unset (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DUTY_CRON_SECRET;
    delete process.env.VERCEL_ENV;
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", { noAuth: true });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 500, "internal_error");
    expect(m.bulkExtendDue).not.toHaveBeenCalled();
    expect(m.syncDutyAttendancePayoutLedger).not.toHaveBeenCalled();
  });

  it("403 when secret set but wrong bearer", async () => {
    process.env.CRON_SECRET = "topsecret";
    delete process.env.VERCEL_ENV;
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { authorization: "Bearer wrong" }
    });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.bulkExtendDue).not.toHaveBeenCalled();
    expect(m.syncDutyAttendancePayoutLedger).not.toHaveBeenCalled();
  });

  it("rejects the legacy x-cron-secret header (Bearer is the only accepted form)", async () => {
    process.env.CRON_SECRET = "topsecret";
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { "x-cron-secret": "topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.bulkExtendDue).not.toHaveBeenCalled();
    expect(m.syncDutyAttendancePayoutLedger).not.toHaveBeenCalled();
  });

  it("accepts Bearer secret header", async () => {
    process.env.CRON_SECRET = "topsecret";
    m.bulkExtendDue.mockResolvedValue({
      success: true,
      data: { ok: true, from: "2026-06-10", to: "2026-06-10", candidate_rows: 1, created_svc: 1, created_payout: 1 }
    });
    m.syncDutyAttendancePayoutLedger.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        attendance: { ok: true, inserted_attendance: 1 },
        payout: {
          ok: true,
          updated_payouts: 1,
          inserted_payouts: 0,
          payout_gross_mismatch_groups: 0,
          attendance_charge_gap_groups: 0,
          attendance_duplicate_groups: 0
        }
      }
    });
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { authorization: "Bearer topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.syncDutyAttendancePayoutLedger).toHaveBeenCalledTimes(1);
  });

  it("surfaces bulkExtendDue errors as 500", async () => {
    process.env.CRON_SECRET = "topsecret";
    m.bulkExtendDue.mockResolvedValue({
      success: false,
      code: "internal_error",
      error: "downstream blew up"
    });
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { authorization: "Bearer topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 500, "internal_error");
    expect(m.syncDutyAttendancePayoutLedger).not.toHaveBeenCalled();
  });

  it("does not invent partial errors for the bulk database RPC", async () => {
    process.env.CRON_SECRET = "topsecret";
    m.bulkExtendDue.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        from: "2026-06-10",
        to: "2026-06-10",
        candidate_rows: 5,
        created_svc: 4,
        created_payout: 4
      }
    });
    m.syncDutyAttendancePayoutLedger.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        attendance: { ok: true, inserted_attendance: 4 },
        payout: {
          ok: true,
          updated_payouts: 4,
          inserted_payouts: 0,
          payout_gross_mismatch_groups: 0,
          attendance_charge_gap_groups: 0,
          attendance_duplicate_groups: 0
        }
      }
    });
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { authorization: "Bearer topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    await expectOkEnvelope(res);
  });

  it("fails loudly when duty ledger reconciliation fails after materialization", async () => {
    process.env.CRON_SECRET = "topsecret";
    m.bulkExtendDue.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        from: "2026-06-10",
        to: "2026-06-10",
        candidate_rows: 2,
        created_svc: 2,
        created_payout: 2
      }
    });
    m.syncDutyAttendancePayoutLedger.mockResolvedValue({
      success: false,
      code: "database_error",
      error: "ledger reconciliation failed"
    });
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { authorization: "Bearer topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 500, "internal_error");
  });
});

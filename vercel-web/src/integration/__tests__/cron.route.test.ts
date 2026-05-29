/**
 * Integration test: GET /api/v1/cron/duties-extend
 *
 * Verifies the cron-secret gating that fail-closes in production, and
 * the success path that proxies through dutyService.extendActive.
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
    extendActive: vi.fn()
  }
}));

import {
  ctx,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest
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
    expect(m.extendActive).not.toHaveBeenCalled();
  });

  it("refuses with 500 in preview / dev when CRON_SECRET is unset (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DUTY_CRON_SECRET;
    delete process.env.VERCEL_ENV;
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", { noAuth: true });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 500, "internal_error");
    expect(m.extendActive).not.toHaveBeenCalled();
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
    expect(m.extendActive).not.toHaveBeenCalled();
  });

  it("rejects the legacy x-cron-secret header (Bearer is the only accepted form)", async () => {
    process.env.CRON_SECRET = "topsecret";
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { "x-cron-secret": "topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.extendActive).not.toHaveBeenCalled();
  });

  it("accepts Bearer secret header", async () => {
    process.env.CRON_SECRET = "topsecret";
    m.extendActive.mockResolvedValue({
      success: true,
      data: { duties: 1, created_svc: 1, created_payout: 1, errors: [] }
    });
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { authorization: "Bearer topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    await expectOkEnvelope(res);
  });

  it("surfaces extendActive errors as 500", async () => {
    process.env.CRON_SECRET = "topsecret";
    m.extendActive.mockResolvedValue({
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
  });

  it("surfaces partial duty errors as 500 with summary details", async () => {
    process.env.CRON_SECRET = "topsecret";
    m.extendActive.mockResolvedValue({
      success: true,
      data: {
        duties: 5,
        created_svc: 4,
        created_payout: 4,
        errors: ["DUTY9 failed: foo"]
      }
    });
    const req = makeRequest("GET", "/api/v1/cron/duties-extend", {
      noAuth: true,
      headers: { authorization: "Bearer topsecret" }
    });
    const res = await CronGet(req, ctx({}));
    const body = await expectErrorEnvelope(res, 500, "internal_error");
    expect(body.error).toContain("1 duty error");
  });
});

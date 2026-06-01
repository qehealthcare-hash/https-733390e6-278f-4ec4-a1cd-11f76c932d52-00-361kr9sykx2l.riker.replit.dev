/**
 * Integration test: GET /api/v1/auth/me + GET /api/v1/health
 *
 * Verifies the harness drives the real `withAuth` pipeline end-to-end:
 * - 401 when Bearer token is missing or invalid.
 * - 403 when the bearer is valid but the actor is not in `hh_users`.
 * - 200 returns the actor envelope built from `hh_users`.
 * - Health endpoint is public and tolerates a healthy supabase mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});

import {
  ACTORS,
  ctx,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";

import { GET as MeGet } from "../../../app/api/v1/auth/me/route";
import { GET as HealthGet } from "../../../app/api/v1/health/route";
import { GET as HealthAliasGet } from "../../../app/api/health/route";

describe("GET /api/v1/auth/me", () => {
  beforeEach(() => {
    setActor(null);
  });

  it("returns 401 when no Authorization header is sent", async () => {
    const req = makeRequest("GET", "/api/v1/auth/me", { noAuth: true });
    const res = await MeGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("returns 401 when the bearer token is wrong", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("GET", "/api/v1/auth/me", { bearer: "wrong-token" });
    const res = await MeGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("returns 403 when the bearer is valid but actor not provisioned", async () => {
    const { setAuthOnly } = await import("@/test/routeHarness");
    setAuthOnly("ghost@hominal.test");
    const req = makeRequest("GET", "/api/v1/auth/me");
    const res = await MeGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
  });

  it("returns the actor envelope when authenticated", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("GET", "/api/v1/auth/me");
    const res = await MeGet(req, ctx({}));
    const data = await expectOkEnvelope<{ id: string; email: string; role: string; username: string }>(
      res
    );
    expect(data.id).toBe(ACTORS.admin.userId);
    expect(data.email).toBe(ACTORS.admin.email);
    expect(data.role).toBe("Admin");
    expect(data.username).toBe("admin");
  });
});

describe("GET /api/v1/health", () => {
  it("returns the public health envelope without auth", async () => {
    const res = await HealthGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.service).toBe("hominal-crm-api");
    expect(body.data.version).toBe(1);
    expect(body.data.deps.supabase.ok).toBe(true);
    expect(typeof body.data.time).toBe("string");
  });
});

describe("GET /api/health (alias)", () => {
  it("re-exports the same handler as /api/v1/health", async () => {
    const res = await HealthAliasGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.service).toBe("hominal-crm-api");
  });
});

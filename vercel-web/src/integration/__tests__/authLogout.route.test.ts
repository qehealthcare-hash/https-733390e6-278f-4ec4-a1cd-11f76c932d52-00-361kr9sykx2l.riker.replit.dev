/**
 * Integration test: POST /api/v1/auth/logout
 *
 * Verifies the M1-C1 server-side logout flow end-to-end:
 *   - 401 when Bearer token is missing or invalid.
 *   - 200 + `revoked:true` for a valid actor; the GoTrue `/auth/v1/logout`
 *     endpoint is hit with the actor's access token + the requested scope
 *     (default = "global").
 *   - Tolerates an empty / missing body (no body required).
 *   - GoTrue 5xx is surfaced as `revoked:false` but the HTTP response
 *     stays 200 so the browser can still finish its local clear.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});

// authService writes an audit row. The route harness's `noopChain` already
// swallows inserts to `hh_audit_logs`, but we also force `API_AUDIT_DISABLED`
// equivalent behavior by stubbing the repository write — this keeps the
// test focused on the auth flow.
vi.mock("@/database/auditRepository", () => ({
  auditRepository: {
    insert: vi.fn().mockResolvedValue({ success: true, data: null })
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

import { POST as LogoutPost } from "../../../app/api/v1/auth/logout/route";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let fetchCalls: FetchCall[] = [];
let nextFetchResponse: { ok: boolean; status: number; body?: string } = {
  ok: true,
  status: 204
};

const originalFetch = global.fetch;

beforeEach(() => {
  setActor(null);
  fetchCalls = [];
  nextFetchResponse = { ok: true, status: 204 };
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const { ok, status, body } = nextFetchResponse;
    // Status 204 must have no body per Fetch spec; undici throws otherwise.
    const respBody = status === 204 || status === 304 ? null : (body ?? "");
    return new Response(respBody, { status, statusText: ok ? "OK" : "Error" });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("POST /api/v1/auth/logout", () => {
  it("returns 401 when no Authorization header is sent", async () => {
    const req = makeRequest("POST", "/api/v1/auth/logout", {
      noAuth: true,
      body: {}
    });
    const res = await LogoutPost(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns 401 when the bearer token is wrong", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("POST", "/api/v1/auth/logout", {
      bearer: "wrong-token",
      body: {}
    });
    const res = await LogoutPost(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(fetchCalls).toHaveLength(0);
  });

  it("revokes the session globally for a valid actor (default scope)", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("POST", "/api/v1/auth/logout", { body: {} });
    const res = await LogoutPost(req, ctx({}));
    const data = await expectOkEnvelope<{
      revoked: boolean;
      scope: string;
      revoke_error?: string | null;
    }>(res);
    expect(data.revoked).toBe(true);
    expect(data.scope).toBe("global");
    expect(data.revoke_error ?? null).toBeNull();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0];
    expect(call.url).toMatch(/\/auth\/v1\/logout\?scope=global$/);
    expect(call.init?.method).toBe("POST");
    const headers = call.init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer test-access-token");
  });

  it("forwards an explicit scope=local through to GoTrue", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/auth/logout", {
      body: { scope: "local" }
    });
    const res = await LogoutPost(req, ctx({}));
    const data = await expectOkEnvelope<{ scope: string }>(res);
    expect(data.scope).toBe("local");
    expect(fetchCalls[0].url).toMatch(/scope=local$/);
  });

  it("tolerates a request with no body (still revokes globally)", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("POST", "/api/v1/auth/logout");
    const res = await LogoutPost(req, ctx({}));
    const data = await expectOkEnvelope<{ revoked: boolean; scope: string }>(res);
    expect(data.revoked).toBe(true);
    expect(data.scope).toBe("global");
  });

  it("falls back to default scope when body has an invalid scope value", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("POST", "/api/v1/auth/logout", {
      body: { scope: "not-a-real-scope" }
    });
    const res = await LogoutPost(req, ctx({}));
    const data = await expectOkEnvelope<{ scope: string }>(res);
    expect(data.scope).toBe("global");
    expect(fetchCalls[0].url).toMatch(/scope=global$/);
  });

  it("returns 200 with revoked=false when GoTrue is unavailable (so the browser can still local-clear)", async () => {
    setActor(ACTORS.admin);
    nextFetchResponse = { ok: false, status: 502, body: "bad gateway" };
    const req = makeRequest("POST", "/api/v1/auth/logout", { body: {} });
    const res = await LogoutPost(req, ctx({}));
    const data = await expectOkEnvelope<{
      revoked: boolean;
      scope: string;
      revoke_error?: string | null;
    }>(res);
    expect(data.revoked).toBe(false);
    expect(data.scope).toBe("global");
    expect(data.revoke_error).toBeTruthy();
  });
});

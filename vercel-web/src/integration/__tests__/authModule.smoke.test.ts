/**
 * Auth module smoke — login, session refresh, logout, and /me (QA_SIGNOFF gates).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "anon-key",
      supabaseServiceRoleKey: "service-role-key"
    }
  };
});

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
import { POST as LoginPost } from "../../../app/api/v1/auth/login/route";
import { POST as RefreshPost } from "../../../app/api/v1/auth/refresh/route";
import { POST as LogoutPost } from "../../../app/api/v1/auth/logout/route";
import { GET as MeGet } from "../../../app/api/v1/auth/me/route";
import { GET as HealthGet } from "../../../app/api/v1/health/route";
import { REFRESH_COOKIE_NAME, SESSION_HINT_COOKIE_NAME } from "@/lib/auth/refreshCookie";

const originalFetch = global.fetch;

describe("Auth module smoke — login proxy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects empty password with 400", async () => {
    const req = new NextRequest("http://test.local/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "admin", password: "" })
    });
    const res = await LoginPost(req);
    await expectErrorEnvelope(res, 400);
  });

  it("returns access_token without refresh_token in JSON on success", async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("_hh_resolve_login_email")) {
        return new Response(JSON.stringify("admin@hominal.test"), { status: 200 });
      }
      if (href.includes("/auth/v1/token")) {
        return new Response(
          JSON.stringify({
            access_token: "access-abc",
            refresh_token: "refresh-xyz",
            expires_in: 3600,
            expires_at: 9999999999,
            user: { id: "u1", email: "admin@hominal.test" }
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const req = new NextRequest("http://test.local/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "admin", password: "secret" })
    });
    const res = await LoginPost(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.access_token).toBe("access-abc");
    expect(body.data.refresh_token).toBeUndefined();
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain(REFRESH_COOKIE_NAME);
    expect(setCookie).toContain(SESSION_HINT_COOKIE_NAME + "=1");
  });
});

describe("Auth module smoke — session lifecycle routes", () => {
  beforeEach(() => {
    setActor(null);
    vi.restoreAllMocks();
  });

  it("GET /auth/me returns actor for provisioned Admin", async () => {
    setActor(ACTORS.admin);
    const res = await MeGet(makeRequest("GET", "/api/v1/auth/me"), ctx({}));
    const data = await expectOkEnvelope<{ role: string; email: string }>(res);
    expect(data.role).toBe("Admin");
    expect(data.email).toBe(ACTORS.admin.email);
  });

  it("POST /auth/refresh returns 401 without cookie", async () => {
    const res = await RefreshPost(
      new NextRequest("http://test.local/api/v1/auth/refresh", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });

  it("GET /health is public", async () => {
    const res = await HealthGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.service).toBe("hominal-crm-api");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/env", () => ({
  env: {
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key"
  }
}));

import { POST as RefreshPost } from "../../../app/api/v1/auth/refresh/route";
import { REFRESH_COOKIE_NAME, SESSION_HINT_COOKIE_NAME } from "@/lib/auth/refreshCookie";

describe("POST /api/v1/auth/refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when refresh cookie is missing", async () => {
    const req = new NextRequest("http://test.local/api/v1/auth/refresh", { method: "POST" });
    const res = await RefreshPost(req);
    expect(res.status).toBe(401);
  });

  it("returns access_token without refresh_token in JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600
        })
      })
    );

    const req = new NextRequest("http://test.local/api/v1/auth/refresh", {
      method: "POST",
      headers: { cookie: `${REFRESH_COOKIE_NAME}=old-refresh` }
    });
    const res = await RefreshPost(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.access_token).toBe("new-access");
    expect(body.data.refresh_token).toBeUndefined();
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain(REFRESH_COOKIE_NAME);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toContain(SESSION_HINT_COOKIE_NAME + "=1");
  });

  it("clears session hint cookie on 401", async () => {
    const req = new NextRequest("http://test.local/api/v1/auth/refresh", { method: "POST" });
    const res = await RefreshPost(req);
    const setCookie = res.headers.get("set-cookie") || "";
    expect(res.status).toBe(401);
    expect(setCookie).toContain(`${SESSION_HINT_COOKIE_NAME}=;`);
    expect(setCookie.toLowerCase()).toContain("max-age=0");
  });
});

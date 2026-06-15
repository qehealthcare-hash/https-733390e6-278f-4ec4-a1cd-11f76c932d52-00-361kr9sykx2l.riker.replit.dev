import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_ERROR_CODE } from "@/lib/api-client";
import { authClient } from "@/lib/clients/authClient";

const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe("authClient wire contracts", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("login validates session payload", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          access_token: "access-1",
          expires_in: 3600,
          user: { id: "u1", email: "ops@test.com" }
        }
      })
    );

    const data = await authClient.login("ops", "secret");
    expect(data.access_token).toBe("access-1");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ identifier: "ops", password: "secret" })
      })
    );
  });

  it("refresh validates access token payload", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: { access_token: "rotated", expires_in: 3600 }
      })
    );

    const data = await authClient.refresh();
    expect(data.access_token).toBe("rotated");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/auth/refresh",
      expect.objectContaining({
        method: "POST",
        credentials: "include"
      })
    );
  });

  it("logout validates revoke payload", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: { revoked: true, scope: "global" }
      })
    );

    const data = await authClient.logout({ access_token: "tok" }, "global");
    expect(data.revoked).toBe(true);
    expect(data.scope).toBe("global");
  });

  it("surfaces contract_error when login payload drifts", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: { access_token: 123 }
      })
    );

    await expect(authClient.login("ops", "secret")).rejects.toMatchObject({
      code: CONTRACT_ERROR_CODE
    });
  });
});

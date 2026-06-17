import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CONTRACT_ERROR_CODE,
  requestValidated,
  validateApiPayload
} from "@/lib/api-client";

const schema = z.object({
  id: z.string(),
  total: z.number().int().nonnegative()
});

const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe("api-client wire contract validation", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { id: "PAT1", total: 3 }
      })
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("validateApiPayload returns parsed data when schema matches", () => {
    const data = validateApiPayload("/patients", { id: "PAT1", total: 3 }, schema);
    expect(data).toEqual({ id: "PAT1", total: 3 });
  });

  it("validateApiPayload throws contract_error when schema mismatches", () => {
    expect(() => validateApiPayload("/patients", { id: "PAT1", total: "bad" }, schema)).toThrowError(
      /failed contract validation/i
    );
    try {
      validateApiPayload("/patients", { id: "PAT1", total: "bad" }, schema);
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe(CONTRACT_ERROR_CODE);
    }
  });

  it("requestValidated unwraps envelope and validates payload", async () => {
    const data = await requestValidated("/patients", null, { access_token: "tok" }, schema);
    expect(data).toEqual({ id: "PAT1", total: 3 });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/patients",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok"
        })
      })
    );
  });

  it("requestValidated surfaces API failure envelopes without validating data", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: "Forbidden", code: "forbidden" }, 403)
    );
    await expect(requestValidated("/patients", null, { access_token: "tok" }, schema)).rejects.toMatchObject({
      message: "Forbidden",
      code: "forbidden",
      status: 403
    });
  });

  it("never surfaces HTML error pages to the caller", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 522,
      headers: { get: () => "text/html" },
      text: async () => "<!DOCTYPE html><html><body>522 Connection timed out</body></html>"
    } as unknown as Response);
    await expect(requestValidated("/billings", null, { access_token: "tok" }, schema)).rejects.toMatchObject({
      message: /timed out/i
    });
  });

  it("preserves upstream_error JSON on 502 instead of generic gateway text", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error:
            "Sign-in service is temporarily unavailable — the database took too long to respond. Wait a minute and try again.",
          code: "upstream_error"
        },
        502
      )
    );
    await expect(
      requestValidated("/auth/login", { method: "POST", body: { identifier: "a", password: "b" } }, null, schema)
    ).rejects.toMatchObject({
      message: /database took too long/i,
      code: "upstream_error",
      status: 502
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * Integration test: WhatsApp webhook (GET verification + POST signature).
 *
 * - GET handshake returns the challenge when verify_token matches.
 * - GET returns 403 when verify_token mismatches.
 * - POST returns 401 when X-Hub-Signature-256 is missing/invalid (and a secret is set).
 * - POST accepts a valid signature and calls whatsappService.recordWebhook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/whatsappService", () => ({
  whatsappService: {
    recordWebhook: vi
      .fn()
      .mockResolvedValue({ success: true, data: { ok: true, verified: true, inserted: 1 } })
  }
}));

import { makeRequest } from "@/test/routeHarness";
import { whatsappService } from "@/services/whatsappService";

import {
  GET as WhatsAppGet,
  POST as WhatsAppPost
} from "../../../app/api/v1/whatsapp/webhook/route";

const m = whatsappService as unknown as Record<string, ReturnType<typeof vi.fn>>;

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("GET /api/v1/whatsapp/webhook (handshake)", () => {
  it("returns the challenge when verify_token matches the env value", async () => {
    const url =
      "/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=hello-world";
    const req = makeRequest("GET", url, { noAuth: true });
    const res = await WhatsAppGet(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello-world");
  });

  it("returns 403 when verify_token does not match", async () => {
    const url =
      "/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x";
    const req = makeRequest("GET", url, { noAuth: true });
    const res = await WhatsAppGet(req);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/whatsapp/webhook (signature)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when signature is missing (secret configured)", async () => {
    const req = makeRequest("POST", "/api/v1/whatsapp/webhook", {
      noAuth: true,
      body: { entry: [] }
    });
    const res = await WhatsAppPost(req);
    expect(res.status).toBe(401);
    expect(m.recordWebhook).not.toHaveBeenCalled();
  });

  it("returns 401 when signature is wrong", async () => {
    const req = makeRequest("POST", "/api/v1/whatsapp/webhook", {
      noAuth: true,
      body: { entry: [] },
      headers: { "x-hub-signature-256": "sha256=deadbeef" }
    });
    const res = await WhatsAppPost(req);
    expect(res.status).toBe(401);
    expect(m.recordWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const raw = "{not-json";
    const req = makeRequest("POST", "/api/v1/whatsapp/webhook", {
      noAuth: true,
      rawBody: raw,
      headers: { "x-hub-signature-256": sign("test-secret", raw) }
    });
    const res = await WhatsAppPost(req);
    expect(res.status).toBe(400);
  });

  it("accepts a valid signed payload and forwards to whatsappService.recordWebhook", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: { messages: [{ id: "wamid1", from: "9999", text: { body: "hi" } }] }
            }
          ]
        }
      ]
    };
    const raw = JSON.stringify(payload);
    const req = makeRequest("POST", "/api/v1/whatsapp/webhook", {
      noAuth: true,
      rawBody: raw,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign("test-secret", raw)
      }
    });
    const res = await WhatsAppPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.verified).toBe(true);
    expect(m.recordWebhook).toHaveBeenCalledWith(payload, { verified: true });
  });
});

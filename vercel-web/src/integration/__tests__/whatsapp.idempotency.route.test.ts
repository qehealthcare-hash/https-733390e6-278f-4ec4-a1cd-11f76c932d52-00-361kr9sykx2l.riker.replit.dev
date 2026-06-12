/**
 * P0-B: WhatsApp outbound routes must dedupe double-clicks / strict-mode replays.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/mutationAudit", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildMutationAuditMock();
});
vi.mock("@/services/whatsappService", () => ({
  whatsappService: {
    sendText: vi.fn(),
    sendBill: vi.fn(),
    sendTemplate: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  resetIdempotencyStore,
  setActor
} from "@/test/routeHarness";
import { whatsappService } from "@/services/whatsappService";

import { POST as WhatsAppSendPost } from "../../../app/api/v1/whatsapp/send/route";
import { POST as WhatsAppSendBillPost } from "../../../app/api/v1/whatsapp/send-bill/route";
import { POST as WhatsAppSendTemplatePost } from "../../../app/api/v1/whatsapp/send-template/route";

const m = whatsappService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const sampleTextBody = {
  to: "+919000000001",
  text: "Hello from CRM test"
};

describe("WhatsApp outbound idempotency (P0-B)", () => {
  beforeEach(() => {
    setActor(ACTORS.admin);
    vi.resetAllMocks();
    resetIdempotencyStore();
  });

  it("POST /whatsapp/send replays the cached envelope for the same Idempotency-Key", async () => {
    m.sendText.mockResolvedValueOnce({
      success: true,
      data: { id: "WA1", provider_message_id: "meta-1" }
    });

    const key = "44444444-4444-4444-8444-444444444444";
    const req1 = makeRequest("POST", "/api/v1/whatsapp/send", {
      body: sampleTextBody,
      headers: { "idempotency-key": key }
    });
    const res1 = await WhatsAppSendPost(req1, ctx({}));
    const data1 = await expectOkEnvelope<{ id: string }>(res1);
    expect(data1.id).toBe("WA1");
    expect(m.sendText).toHaveBeenCalledTimes(1);

    m.sendText.mockResolvedValueOnce({
      success: true,
      data: { id: "WA_SHOULD_NOT_RUN", provider_message_id: "meta-2" }
    });
    const req2 = makeRequest("POST", "/api/v1/whatsapp/send", {
      body: sampleTextBody,
      headers: { "idempotency-key": key }
    });
    const res2 = await WhatsAppSendPost(req2, ctx({}));
    expect(res2.status).toBe(200);
    expect(res2.headers.get("Idempotent-Replay")).toBe("true");
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.data.id).toBe("WA1");
    expect(m.sendText).toHaveBeenCalledTimes(1);
  });

  it("POST /whatsapp/send-bill without Idempotency-Key dedupes identical bodies", async () => {
    m.sendBill.mockResolvedValueOnce({
      success: true,
      data: { id: "WA_BILL", provider_message_id: "meta-bill" }
    });

    const body = { to: "+919000000002", billing_id: "BILL1" };
    for (let i = 0; i < 2; i++) {
      const req = makeRequest("POST", "/api/v1/whatsapp/send-bill", { body });
      await WhatsAppSendBillPost(req, ctx({}));
    }
    expect(m.sendBill).toHaveBeenCalledTimes(1);
  });

  it("POST /whatsapp/send-template runs twice when bodies differ", async () => {
    m.sendTemplate
      .mockResolvedValueOnce({
        success: true,
        data: { id: "WA_T1", provider_message_id: "meta-t1" }
      })
      .mockResolvedValueOnce({
        success: true,
        data: { id: "WA_T2", provider_message_id: "meta-t2" }
      });

    await WhatsAppSendTemplatePost(
      makeRequest("POST", "/api/v1/whatsapp/send-template", {
        body: {
          to: "+919000000003",
          template: "hello_world",
          language: "en"
        }
      }),
      ctx({})
    );
    await WhatsAppSendTemplatePost(
      makeRequest("POST", "/api/v1/whatsapp/send-template", {
        body: {
          to: "+919000000003",
          template: "invoice_ready",
          language: "en"
        }
      }),
      ctx({})
    );
    expect(m.sendTemplate).toHaveBeenCalledTimes(2);
  });
});

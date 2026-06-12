/**
 * P1-A: POST /inquiries/[id]/convert dedupes double-submit via withIdempotency.
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
vi.mock("@/services/inquiryService", () => ({
  inquiryService: {
    convertToPatient: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  makeRequest,
  resetIdempotencyStore,
  setActor
} from "@/test/routeHarness";
import { inquiryService } from "@/services/inquiryService";

import { POST as InquiryConvertPost } from "../../../app/api/v1/inquiries/[id]/convert/route";

const m = inquiryService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("POST /inquiries/[id]/convert idempotency (P1-A)", () => {
  beforeEach(() => {
    setActor(ACTORS.manager);
    vi.resetAllMocks();
    resetIdempotencyStore();
  });

  it("replays the cached envelope for the same Idempotency-Key", async () => {
    m.convertToPatient.mockResolvedValueOnce({
      success: true,
      data: {
        patient_id: "PAT1",
        inquiry_id: "INQ1",
        inquiry: { id: "INQ1", status: "Converted" },
        alreadyConverted: false
      }
    });

    const key = "55555555-5555-4555-8555-555555555555";
    const req1 = makeRequest("POST", "/api/v1/inquiries/INQ1/convert", {
      body: { notes: "Ready" },
      headers: { "idempotency-key": key }
    });
    const res1 = await InquiryConvertPost(req1, ctx({ id: "INQ1" }));
    const data1 = await expectCreatedEnvelope<{ patient_id: string }>(res1);
    expect(data1.patient_id).toBe("PAT1");
    expect(m.convertToPatient).toHaveBeenCalledTimes(1);

    m.convertToPatient.mockResolvedValueOnce({
      success: true,
      data: {
        patient_id: "PAT_SHOULD_NOT_RUN",
        inquiry_id: "INQ1",
        alreadyConverted: false
      }
    });
    const req2 = makeRequest("POST", "/api/v1/inquiries/INQ1/convert", {
      body: { notes: "Ready" },
      headers: { "idempotency-key": key }
    });
    const res2 = await InquiryConvertPost(req2, ctx({ id: "INQ1" }));
    expect(res2.status).toBe(201);
    expect(res2.headers.get("Idempotent-Replay")).toBe("true");
    const body2 = await res2.json();
    expect(body2.data.patient_id).toBe("PAT1");
    expect(m.convertToPatient).toHaveBeenCalledTimes(1);
  });

  it("does not collapse different inquiry ids when bodies match (per-id route key)", async () => {
    m.convertToPatient
      .mockResolvedValueOnce({
        success: true,
        data: {
          patient_id: "PAT_A",
          inquiry_id: "INQ_A",
          alreadyConverted: false
        }
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          patient_id: "PAT_B",
          inquiry_id: "INQ_B",
          alreadyConverted: false
        }
      });

    await InquiryConvertPost(
      makeRequest("POST", "/api/v1/inquiries/INQ_A/convert", { body: {} }),
      ctx({ id: "INQ_A" })
    );
    await InquiryConvertPost(
      makeRequest("POST", "/api/v1/inquiries/INQ_B/convert", { body: {} }),
      ctx({ id: "INQ_B" })
    );
    expect(m.convertToPatient).toHaveBeenCalledTimes(2);
  });
});

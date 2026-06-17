/**
 * Contract gate: billing list payloads must satisfy BillingListResponseDTO.
 *
 * Regression for production bill B0529099390 — net receipts −5000 after a
 * reversal receipt caused `moneySchema` (>= 0) to reject the whole list.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseBillingListResponseDto } from "@/validation/billingDto";
import { billingListResponseFixture } from "@/test/billingListFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/mutationAudit", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildMutationAuditMock();
});
vi.mock("@/services/billingService", () => ({
  billingService: {
    list: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { billingService } from "@/services/billingService";
import { GET as BillingsGet } from "../../../app/api/v1/billings/route";

const m = billingService as unknown as { list: ReturnType<typeof vi.fn> };

describe("BillingListResponseDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("parseBillingListResponseDto accepts negative net receipt totals", () => {
    const parsed = parseBillingListResponseDto(billingListResponseFixture());
    expect(parsed.success).toBe(true);
  });

  it("GET /api/v1/billings envelope data satisfies BillingListResponseDTO", async () => {
    setActor(ACTORS.accountant);
    const payload = billingListResponseFixture();
    m.list.mockResolvedValue({ success: true, data: payload });

    const res = await BillingsGet(makeRequest("GET", "/api/v1/billings?limit=50"), ctx({}));
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseBillingListResponseDto(data);
    if (!parsed.success) {
      console.error(parsed.error.flatten());
    }
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rows[0]?.totals?.receipts).toBe(-5000);
    }
  });

  it("GET /api/v1/billings returns valid rows when one row fails validation", async () => {
    setActor(ACTORS.accountant);
    const good = billingListResponseFixture().rows[0];
    m.list.mockResolvedValue({
      success: true,
      data: {
        rows: [good, { id: "!!!bad!!!", patient_id: "P1", status: "Active" }],
        total: 2
      }
    });

    const res = await BillingsGet(makeRequest("GET", "/api/v1/billings?limit=50"), ctx({}));
    const data = await expectOkEnvelope<{ rows: unknown[]; total: number }>(res);
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows).toHaveLength(1);
    expect(data.total).toBe(2);
  });
});

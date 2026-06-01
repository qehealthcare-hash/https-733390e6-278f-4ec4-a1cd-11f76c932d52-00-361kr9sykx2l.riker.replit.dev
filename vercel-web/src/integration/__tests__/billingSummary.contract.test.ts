/**
 * Contract gate: billing workspace payloads must satisfy BillingSummaryDTO.
 *
 * Runs in CI via `npm test` (vercel-web-ci.yml). Catches drift between
 * billingService.getById / API envelopes and the Zod read-model schema.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseBillingSummaryDto } from "@/validation/billingDto";
import { billingSummaryFixture } from "@/test/billingSummaryFixture";

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
    getById: vi.fn()
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
import { GET as BillingByIdGet } from "../../../app/api/v1/billings/[id]/route";

const m = billingService as unknown as { getById: ReturnType<typeof vi.fn> };

describe("BillingSummaryDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("parseBillingSummaryDto accepts the canonical fixture", () => {
    const parsed = parseBillingSummaryDto(billingSummaryFixture());
    expect(parsed.success).toBe(true);
  });

  it("GET /api/v1/billings/[id] envelope data satisfies BillingSummaryDTO", async () => {
    setActor(ACTORS.accountant);
    const bundle = billingSummaryFixture();
    m.getById.mockResolvedValue({ success: true, data: bundle });

    const res = await BillingByIdGet(
      makeRequest("GET", "/api/v1/billings/B0528117702"),
      ctx({ id: "B0528117702" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseBillingSummaryDto(data);
    if (!parsed.success) {
      console.error(parsed.error.flatten());
    }
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canReceive).toBe(true);
      expect(parsed.data.totals.billed).toBe(6050);
    }
  });

  it("rejects bundles missing permissions (regression guard)", () => {
    const { permissions: _removed, ...withoutPerms } = billingSummaryFixture();
    const parsed = parseBillingSummaryDto(withoutPerms);
    expect(parsed.success).toBe(false);
  });
});

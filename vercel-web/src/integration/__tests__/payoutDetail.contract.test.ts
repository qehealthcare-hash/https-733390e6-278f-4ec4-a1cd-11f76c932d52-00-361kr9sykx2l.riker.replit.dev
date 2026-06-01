import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePayoutDetailDto } from "@/validation/payoutDto";
import { payoutDetailFixture } from "@/test/payoutDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/payoutService", () => ({
  payoutService: { getById: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { payoutService } from "@/services/payoutService";
import { GET as PayoutByIdGet } from "../../../app/api/v1/payouts/[id]/route";

const m = payoutService as unknown as { getById: ReturnType<typeof vi.fn> };

describe("PayoutDetailDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/payouts/[id] data satisfies PayoutDetailDTO", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: payoutDetailFixture()
    });
    const res = await PayoutByIdGet(
      makeRequest("GET", "/api/v1/payouts/PAY2026050001"),
      ctx({ id: "PAY2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parsePayoutDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canPayFinal).toBe(true);
    }
  });
});

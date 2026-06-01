import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDutyDetailDto } from "@/validation/dutyDto";
import { dutyDetailFixture } from "@/test/dutyDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/dutyService", () => ({
  dutyService: { getById: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { dutyService } from "@/services/dutyService";
import { GET as DutyByIdGet } from "../../../app/api/v1/duties/[id]/route";

const m = dutyService as unknown as { getById: ReturnType<typeof vi.fn> };

describe("DutyDetailDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/duties/[id] data satisfies DutyDetailDTO", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: dutyDetailFixture()
    });
    const res = await DutyByIdGet(
      makeRequest("GET", "/api/v1/duties/DTY2026050001"),
      ctx({ id: "DTY2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseDutyDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // SCHEDULED is the default fixture state — full edit/check-in window.
      expect(parsed.data.permissions.canEdit).toBe(true);
      expect(parsed.data.permissions.canCheckIn).toBe(true);
      expect(parsed.data.permissions.canCancel).toBe(true);
    }
  });

  it("returns terminal flags for a COMPLETED duty", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: dutyDetailFixture({ status: "COMPLETED" })
    });
    const res = await DutyByIdGet(
      makeRequest("GET", "/api/v1/duties/DTY2026050001"),
      ctx({ id: "DTY2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseDutyDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canEdit).toBe(false);
      expect(parsed.data.permissions.canCancel).toBe(false);
      expect(parsed.data.permissions.canCheckIn).toBe(false);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDutyDetailDto } from "@/validation/dutyDto";
import { dutyDetailFixture } from "@/test/dutyDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/dutyService", () => ({
  dutyService: { list: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { dutyService } from "@/services/dutyService";
import { GET as DutiesGet } from "../../../app/api/v1/duties/route";

const m = dutyService as unknown as { list: ReturnType<typeof vi.fn> };

describe("DutyListDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/duties rows satisfy DutyDetailDTO including permissions", async () => {
    setActor(ACTORS.manager);
    m.list.mockResolvedValue({
      success: true,
      data: {
        rows: [
          dutyDetailFixture(),
          dutyDetailFixture({ id: "DTY2026050002", status: "COMPLETED" })
        ],
        total: 2
      }
    });
    const res = await DutiesGet(makeRequest("GET", "/api/v1/duties"), ctx({}));
    const data = await expectOkEnvelope<{ rows: unknown[]; total: number }>(res);
    expect(data.total).toBe(2);
    expect(data.rows).toHaveLength(2);

    for (const row of data.rows) {
      const parsed = parseDutyDetailDto(row);
      expect(parsed.success).toBe(true);
    }

    const scheduled = parseDutyDetailDto(data.rows[0]);
    const completed = parseDutyDetailDto(data.rows[1]);
    if (scheduled.success) {
      expect(scheduled.data.permissions.canEdit).toBe(true);
      expect(scheduled.data.permissions.canCheckIn).toBe(true);
    }
    if (completed.success) {
      expect(completed.data.permissions.canEdit).toBe(false);
      expect(completed.data.permissions.canCheckIn).toBe(false);
    }
  });
});

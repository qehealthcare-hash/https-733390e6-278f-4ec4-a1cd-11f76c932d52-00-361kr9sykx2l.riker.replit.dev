import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseInquiryDetailDto } from "@/validation/inquiryDto";
import { inquiryDetailFixture } from "@/test/inquiryDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/inquiryService", () => ({
  inquiryService: { getById: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { inquiryService } from "@/services/inquiryService";
import { GET as InquiryByIdGet } from "../../../app/api/v1/inquiries/[id]/route";

const m = inquiryService as unknown as { getById: ReturnType<typeof vi.fn> };

describe("InquiryDetailDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/inquiries/[id] data satisfies InquiryDetailDTO", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: inquiryDetailFixture()
    });
    const res = await InquiryByIdGet(
      makeRequest("GET", "/api/v1/inquiries/INQ2026050001"),
      ctx({ id: "INQ2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseInquiryDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canEdit).toBe(true);
      expect(parsed.data.permissions.canConvert).toBe(true);
      expect(parsed.data.permissions.canReopen).toBe(false);
    }
  });

  it("returns terminal permissions for a Converted inquiry", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: inquiryDetailFixture({ status: "Converted" })
    });
    const res = await InquiryByIdGet(
      makeRequest("GET", "/api/v1/inquiries/INQ2026050001"),
      ctx({ id: "INQ2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseInquiryDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canEdit).toBe(false);
      expect(parsed.data.permissions.canConvert).toBe(false);
      expect(parsed.data.permissions.canDelete).toBe(false);
    }
  });
});

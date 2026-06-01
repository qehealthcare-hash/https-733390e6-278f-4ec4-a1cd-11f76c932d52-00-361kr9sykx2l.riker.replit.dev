import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseInquiryDetailDto } from "@/validation/inquiryDto";
import { inquiryDetailFixture } from "@/test/inquiryDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/inquiryService", () => ({
  inquiryService: { list: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { inquiryService } from "@/services/inquiryService";
import { GET as InquiriesGet } from "../../../app/api/v1/inquiries/route";

const m = inquiryService as unknown as { list: ReturnType<typeof vi.fn> };

describe("InquiryListDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/inquiries rows satisfy InquiryDetailDTO including permissions", async () => {
    setActor(ACTORS.manager);
    m.list.mockResolvedValue({
      success: true,
      data: {
        rows: [
          inquiryDetailFixture(),
          inquiryDetailFixture({
            id: "INQ2026050002",
            status: "Converted",
            patient_id: "PAT2026050001"
          })
        ],
        total: 2
      }
    });
    const res = await InquiriesGet(makeRequest("GET", "/api/v1/inquiries"), ctx({}));
    const data = await expectOkEnvelope<{ rows: unknown[]; total: number }>(res);
    expect(data.total).toBe(2);

    for (const row of data.rows) {
      const parsed = parseInquiryDetailDto(row);
      expect(parsed.success).toBe(true);
    }

    const open = parseInquiryDetailDto(data.rows[0]);
    const converted = parseInquiryDetailDto(data.rows[1]);
    if (open.success) {
      expect(open.data.permissions.canEdit).toBe(true);
      expect(open.data.permissions.canConvert).toBe(true);
    }
    if (converted.success) {
      expect(converted.data.permissions.canEdit).toBe(false);
      expect(converted.data.permissions.canConvert).toBe(false);
      expect(converted.data.permissions.canReopen).toBe(false);
    }
  });
});

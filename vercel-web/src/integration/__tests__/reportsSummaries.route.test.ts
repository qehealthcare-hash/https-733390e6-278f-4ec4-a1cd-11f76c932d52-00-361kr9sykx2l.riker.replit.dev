/**
 * Integration tests: Phase 12 report summary endpoints.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/reportService", () => ({
  reportService: {
    inquiriesSummary: vi.fn(),
    patientsSummary: vi.fn(),
    attendanceSummary: vi.fn(),
    billingsSummary: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { reportService } from "@/services/reportService";

import { GET as InquiriesGet } from "../../../app/api/v1/reports/inquiries/route";
import { GET as PatientsGet } from "../../../app/api/v1/reports/patients/route";
import { GET as AttendanceGet } from "../../../app/api/v1/reports/attendance/route";
import { GET as BillingsGet } from "../../../app/api/v1/reports/billings/route";

const mReport = reportService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const summaryPayload = {
  summary: { total: 3 },
  rows: [{ id: "1" }],
  pagination: { limit: 50, offset: 0, total: 3 }
};

describe("GET /api/v1/reports/* summaries", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
    mReport.inquiriesSummary.mockResolvedValue({ success: true, data: summaryPayload });
    mReport.patientsSummary.mockResolvedValue({ success: true, data: summaryPayload });
    mReport.attendanceSummary.mockResolvedValue({ success: true, data: summaryPayload });
    mReport.billingsSummary.mockResolvedValue({ success: true, data: summaryPayload });
  });

  it("requires authentication on inquiries", async () => {
    const req = makeRequest("GET", "/api/v1/reports/inquiries?period=2026-05", { noAuth: true });
    const res = await InquiriesGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(mReport.inquiriesSummary).not.toHaveBeenCalled();
  });

  it("denies Staff role on inquiries", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("GET", "/api/v1/reports/inquiries?period=2026-05");
    const res = await InquiriesGet(req, ctx({}));
    await expectErrorEnvelope(res, 403);
    expect(mReport.inquiriesSummary).not.toHaveBeenCalled();
  });

  it("returns inquiry summary for Accountant", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest(
      "GET",
      "/api/v1/reports/inquiries?period=2026-05&limit=25&offset=0&status=New"
    );
    const res = await InquiriesGet(req, ctx({}));
    const data = await expectOkEnvelope<{ summary: { total: number }; rows: unknown[] }>(res);
    expect(data.summary.total).toBe(3);
    expect(mReport.inquiriesSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        period: "2026-05",
        limit: "25",
        offset: "0",
        status: "New"
      }),
      expect.objectContaining({ actor: expect.objectContaining({ role: "Accountant" }) })
    );
  });

  it("returns patient summary for Manager", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("GET", "/api/v1/reports/patients?period=2026-05");
    const res = await PatientsGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(mReport.patientsSummary).toHaveBeenCalled();
  });

  it("returns attendance summary for Admin", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("GET", "/api/v1/reports/attendance?period=2026-05&employee_id=EMP1");
    const res = await AttendanceGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(mReport.attendanceSummary).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: "EMP1" }),
      expect.any(Object)
    );
  });

  it("returns billing summary for Admin", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("GET", "/api/v1/reports/billings?period=2026-05&status=Active");
    const res = await BillingsGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(mReport.billingsSummary).toHaveBeenCalledWith(
      expect.objectContaining({ status: "Active" }),
      expect.any(Object)
    );
  });
});

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

const reportRange = {
  from: "2026-05-01T00:00:00.000Z",
  to: "2026-06-01T00:00:00.000Z"
};

function summaryEnvelope(summary: Record<string, unknown>) {
  return {
    summary,
    rows: [{ id: "1" }],
    rows_total: 3,
    limit: 50,
    offset: 0
  };
}

const inquirySummaryFixture = summaryEnvelope({
  period: "2026-05",
  range: reportRange,
  total: 3,
  followup_due: 0,
  by_status: {},
  by_potential: {},
  by_source: {},
  grouping_truncated: false
});

const patientSummaryFixture = summaryEnvelope({
  period: "2026-05",
  range: reportRange,
  total: 3,
  by_status: {},
  by_area: {},
  grouping_truncated: false
});

const billingSummaryFixture = summaryEnvelope({
  period: "2026-05",
  range: reportRange,
  billings_count: 1,
  service_total: 1000,
  collected: 800,
  pending: 200,
  byStatus: {},
  total_received: 800,
  outstanding: 200
});

describe("GET /api/v1/reports/* summaries", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
    mReport.inquiriesSummary.mockResolvedValue({ success: true, data: inquirySummaryFixture });
    mReport.patientsSummary.mockResolvedValue({ success: true, data: patientSummaryFixture });
    mReport.billingsSummary.mockResolvedValue({ success: true, data: billingSummaryFixture });
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
    mReport.attendanceSummary.mockResolvedValue({
      success: true,
      data: {
        summary: {
          period: "2026-05",
          range: reportRange,
          total: 3,
          by_status: { PRESENT: 2, ABSENT: 1 },
          by_shift: { DAY: 3 },
          by_employee: [
            {
              employee_id: "EMP1",
              present: 2,
              absent: 1,
              late: 0,
              half_day: 0,
              leave: 0,
              holiday: 0,
              hours: 16
            }
          ]
        },
        rows: [],
        rows_total: 3,
        limit: 200,
        offset: 0
      }
    });
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

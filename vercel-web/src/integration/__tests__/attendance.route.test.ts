/**
 * Integration test: attendance API surface.
 *
 * - GET /attendance: role-gated list with filters.
 * - POST /attendance: create with idempotency wrapper.
 * - POST /attendance/day/mark: quick mark + duty sync.
 * - GET /attendance/missing: 400 when required params absent.
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
vi.mock("@/services/attendanceService", () => ({
  attendanceService: {
    list: vi.fn(),
    create: vi.fn(),
    dayMark: vi.fn(),
    listMissingForEmployee: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { attendanceService } from "@/services/attendanceService";

import {
  GET as AttendanceGet,
  POST as AttendancePost
} from "../../../app/api/v1/attendance/route";
import { POST as AttendanceDayMark } from "../../../app/api/v1/attendance/day/mark/route";
import { GET as AttendanceMissing } from "../../../app/api/v1/attendance/missing/route";

const m = attendanceService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/attendance", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Accountant (not in attendance read roles)", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest("GET", "/api/v1/attendance?employee_id=EMP1");
    const res = await AttendanceGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.list).not.toHaveBeenCalled();
  });

  it("forwards filters for Nurse", async () => {
    setActor(ACTORS.nurse);
    m.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest(
      "GET",
      "/api/v1/attendance?employee_id=EMP1&duty_id=DUTY1&status=Present&from=2026-05-01&to=2026-05-31"
    );
    const res = await AttendanceGet(req, ctx({}));
    await expectOkEnvelope(res);
    const [query] = m.list.mock.calls[0];
    expect(query).toMatchObject({
      employee_id: "EMP1",
      duty_id: "DUTY1",
      status: "Present",
      from: "2026-05-01",
      to: "2026-05-31"
    });
  });
});

describe("POST /api/v1/attendance", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("creates and returns 201", async () => {
    setActor(ACTORS.staff);
    m.create.mockResolvedValue({ success: true, data: { id: "ATT1" } });
    const req = makeRequest("POST", "/api/v1/attendance", {
      body: {
        duty_id: "DUTY1",
        employee_id: "EMP1",
        date: "2026-05-25",
        status: "Present"
      }
    });
    const res = await AttendancePost(req, ctx({}));
    const data = await expectCreatedEnvelope<{ id: string }>(res);
    expect(data.id).toBe("ATT1");
  });
});

describe("POST /api/v1/attendance/day/mark", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Viewer", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest("POST", "/api/v1/attendance/day/mark", {
      body: { employee_id: "EMP1", date: "2026-05-25", status: "Present" }
    });
    const res = await AttendanceDayMark(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.dayMark).not.toHaveBeenCalled();
  });

  it("marks the day for Nurse and forwards sync_duty", async () => {
    setActor(ACTORS.nurse);
    m.dayMark.mockResolvedValue({
      success: true,
      data: { id: "ATT1", duty_status: "IN_PROGRESS" }
    });
    const req = makeRequest("POST", "/api/v1/attendance/day/mark", {
      body: {
        employee_id: "EMP1",
        duty_id: "DUTY1",
        date: "2026-05-25",
        status: "Present",
        sync_duty: true
      }
    });
    const res = await AttendanceDayMark(req, ctx({}));
    const data = await expectOkEnvelope<{ duty_status: string }>(res);
    expect(data.duty_status).toBe("IN_PROGRESS");
    expect(m.dayMark).toHaveBeenCalledWith(
      expect.objectContaining({
        employee_id: "EMP1",
        duty_id: "DUTY1",
        status: "Present"
      }),
      expect.any(Object)
    );
  });
});

describe("GET /api/v1/attendance/missing", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("returns 400 when required filters are missing", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("GET", "/api/v1/attendance/missing");
    const res = await AttendanceMissing(req, ctx({}));
    await expectErrorEnvelope(res, 400, "bad_request");
    expect(m.listMissingForEmployee).not.toHaveBeenCalled();
  });

  it("returns missing duties when all filters provided", async () => {
    setActor(ACTORS.manager);
    m.listMissingForEmployee.mockResolvedValue({
      success: true,
      data: [{ duty_id: "DUTY1", date: "2026-05-23" }]
    });
    const req = makeRequest(
      "GET",
      "/api/v1/attendance/missing?employee_id=EMP1&from=2026-05-01&to=2026-05-31"
    );
    const res = await AttendanceMissing(req, ctx({}));
    const data = await expectOkEnvelope<Array<{ duty_id: string }>>(res);
    expect(data).toHaveLength(1);
    expect(m.listMissingForEmployee).toHaveBeenCalledWith(
      "EMP1",
      "2026-05-01",
      "2026-05-31",
      expect.any(Object)
    );
  });
});

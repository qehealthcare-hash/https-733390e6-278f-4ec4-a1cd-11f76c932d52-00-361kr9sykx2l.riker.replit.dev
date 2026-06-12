/**
 * Integration test: attendance API routes not covered by attendance.route.test.ts
 * (M8 Pass A): [id], day board, range, mark.
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
    getById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    dayBoard: vi.fn(),
    rangeBoard: vi.fn(),
    mark: vi.fn()
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
import { attendanceService } from "@/services/attendanceService";

import {
  GET as AttendanceByIdGet,
  PATCH as AttendanceByIdPatch,
  DELETE as AttendanceByIdDelete
} from "../../../app/api/v1/attendance/[id]/route";
import { GET as AttendanceDayGet } from "../../../app/api/v1/attendance/day/route";
import { GET as AttendanceRangeGet } from "../../../app/api/v1/attendance/range/route";
import { POST as AttendanceMarkPost } from "../../../app/api/v1/attendance/mark/route";

const m = attendanceService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/attendance/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("allows Executive (attendance.read parity, M8)", async () => {
    setActor({ ...ACTORS.staff, role: "Executive", email: "executive@hominal.test" });
    m.getById.mockResolvedValue({ success: true, data: { id: "ATT1" } });
    const req = makeRequest("GET", "/api/v1/attendance/ATT1");
    const res = await AttendanceByIdGet(req, ctx({ id: "ATT1" }));
    await expectOkEnvelope(res);
    expect(m.getById).toHaveBeenCalledWith("ATT1", expect.any(Object));
  });

  it("denies Accountant on operational attendance routes", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest("GET", "/api/v1/attendance/ATT1");
    const res = await AttendanceByIdGet(req, ctx({ id: "ATT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.getById).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/attendance/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Executive (read-only)", async () => {
    setActor({ ...ACTORS.staff, role: "Executive", email: "executive@hominal.test" });
    const req = makeRequest("PATCH", "/api/v1/attendance/ATT1", {
      body: { status: "PRESENT" }
    });
    const res = await AttendanceByIdPatch(req, ctx({ id: "ATT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("forwards body for Nurse", async () => {
    setActor(ACTORS.nurse);
    m.update.mockResolvedValue({ success: true, data: { id: "ATT1", status: "LATE" } });
    const req = makeRequest("PATCH", "/api/v1/attendance/ATT1", {
      body: { status: "LATE" }
    });
    const res = await AttendanceByIdPatch(req, ctx({ id: "ATT1" }));
    await expectOkEnvelope(res);
    expect(m.update).toHaveBeenCalledWith("ATT1", { status: "LATE" }, expect.any(Object));
  });
});

describe("DELETE /api/v1/attendance/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("DELETE", "/api/v1/attendance/ATT1");
    const res = await AttendanceByIdDelete(req, ctx({ id: "ATT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("removes for Manager", async () => {
    setActor(ACTORS.manager);
    m.remove.mockResolvedValue({ success: true, data: { id: "ATT1" } });
    const req = makeRequest("DELETE", "/api/v1/attendance/ATT1");
    const res = await AttendanceByIdDelete(req, ctx({ id: "ATT1" }));
    await expectOkEnvelope(res);
    expect(m.remove).toHaveBeenCalledWith("ATT1", expect.any(Object), expect.anything());
  });
});

describe("GET /api/v1/attendance/day", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("forwards date filter for Supervisor", async () => {
    setActor({ ...ACTORS.staff, role: "Supervisor", email: "supervisor@hominal.test" });
    m.dayBoard.mockResolvedValue({ success: true, data: { date: "2026-05-25", rows: [] } });
    const req = makeRequest("GET", "/api/v1/attendance/day?date=2026-05-25&employee_id=EMP1");
    const res = await AttendanceDayGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.dayBoard).toHaveBeenCalledWith(
      "2026-05-25",
      { employee_id: "EMP1", patient_id: undefined },
      expect.any(Object)
    );
  });
});

describe("GET /api/v1/attendance/range", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("forwards window for Staff", async () => {
    setActor(ACTORS.staff);
    m.rangeBoard.mockResolvedValue({ success: true, data: { rows: [], summary: {} } });
    const req = makeRequest(
      "GET",
      "/api/v1/attendance/range?from=2026-05-01&to=2026-05-31&employee_id=EMP1"
    );
    const res = await AttendanceRangeGet(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.rangeBoard).toHaveBeenCalledWith(
      "2026-05-01",
      "2026-05-31",
      { employee_id: "EMP1", patient_id: undefined, status: undefined },
      expect.any(Object)
    );
  });
});

describe("POST /api/v1/attendance/mark", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Viewer", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest("POST", "/api/v1/attendance/mark", {
      body: { employee_id: "EMP1", status: "PRESENT" }
    });
    const res = await AttendanceMarkPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.mark).not.toHaveBeenCalled();
  });

  it("marks for Staff", async () => {
    setActor(ACTORS.staff);
    m.mark.mockResolvedValue({ success: true, data: { id: "ATT1" } });
    const req = makeRequest("POST", "/api/v1/attendance/mark", {
      body: { employee_id: "EMP1", status: "PRESENT", duty_id: "DUTY1" }
    });
    const res = await AttendanceMarkPost(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.mark).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: "EMP1", status: "PRESENT" }),
      expect.any(Object)
    );
  });
});

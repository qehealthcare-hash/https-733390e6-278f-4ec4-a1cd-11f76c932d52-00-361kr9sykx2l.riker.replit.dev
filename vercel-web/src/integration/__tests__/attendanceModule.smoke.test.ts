/**
 * Attendance module smoke — HTTP coverage for mark / PATCH / DELETE
 * optimistic-lock paths.
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
    mark: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    dayMark: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectErrorEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { attendanceService } from "@/services/attendanceService";
import { POST as AttendanceMarkPost } from "../../../app/api/v1/attendance/mark/route";
import { PATCH as AttendancePatch } from "../../../app/api/v1/attendance/[id]/route";
import { DELETE as AttendanceDelete } from "../../../app/api/v1/attendance/[id]/route";
import { POST as AttendanceDayMark } from "../../../app/api/v1/attendance/day/mark/route";

const m = attendanceService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const VERSION = "2026-06-01T12:00:00.000Z";

describe("Attendance module smoke — optimistic concurrency at HTTP layer", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("POST /attendance/mark forwards expected_updated_at and surfaces 409", async () => {
    setActor(ACTORS.staff);
    m.mark.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Attendance was modified by another user"
    });
    const req = makeRequest("POST", "/api/v1/attendance/mark", {
      body: {
        employee_id: "EMP1",
        duty_id: "DUTY1",
        status: "PRESENT",
        check_in_at: "2026-06-01T09:00:00.000+05:30",
        expected_updated_at: VERSION
      }
    });
    const res = await AttendanceMarkPost(req, ctx({}));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.mark).toHaveBeenCalledWith(
      expect.objectContaining({ expected_updated_at: VERSION }),
      expect.any(Object)
    );
  });

  it("PATCH /attendance/[id] forwards expected_updated_at and surfaces 409", async () => {
    setActor(ACTORS.staff);
    m.update.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Attendance was modified by another user"
    });
    const req = makeRequest("PATCH", "/api/v1/attendance/ATT1", {
      body: {
        employee_id: "EMP1",
        status: "PRESENT",
        check_in_at: "2026-06-01T09:00:00.000+05:30",
        expected_updated_at: VERSION
      }
    });
    const res = await AttendancePatch(req, ctx({ id: "ATT1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.update).toHaveBeenCalledWith(
      "ATT1",
      expect.objectContaining({ expected_updated_at: VERSION }),
      expect.any(Object)
    );
  });

  it("DELETE /attendance/[id] forwards expected_updated_at and surfaces 409", async () => {
    setActor(ACTORS.admin);
    m.remove.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Attendance was modified by another user"
    });
    const req = makeRequest("DELETE", "/api/v1/attendance/ATT1", {
      body: { expected_updated_at: VERSION }
    });
    const res = await AttendanceDelete(req, ctx({ id: "ATT1" }));
    await expectErrorEnvelope(res, 409, "conflict");
    expect(m.remove).toHaveBeenCalledWith(
      "ATT1",
      expect.any(Object),
      expect.objectContaining({ expected_updated_at: VERSION })
    );
  });

  it("POST /attendance/day/mark forwards expected_updated_at", async () => {
    setActor(ACTORS.nurse);
    m.dayMark.mockResolvedValue({ success: true, data: { id: "ATT1" } });
    const req = makeRequest("POST", "/api/v1/attendance/day/mark", {
      body: {
        employee_id: "EMP1",
        duty_id: "DUTY1",
        date: "2026-06-01",
        status: "PRESENT",
        expected_updated_at: VERSION
      }
    });
    const res = await AttendanceDayMark(req, ctx({}));
    expect(res.status).toBe(200);
    expect(m.dayMark).toHaveBeenCalledWith(
      expect.objectContaining({ expected_updated_at: VERSION }),
      expect.any(Object)
    );
  });
});

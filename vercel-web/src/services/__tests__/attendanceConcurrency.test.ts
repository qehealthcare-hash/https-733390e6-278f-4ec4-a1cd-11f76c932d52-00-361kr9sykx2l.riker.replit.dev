import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceService } from "@/services/attendanceService";
import { attendanceRepository } from "@/database/attendanceRepository";
import { DUTY_CALENDAR_ATTENDANCE_SOT_MESSAGE } from "@/business/dutySourceOfTruth";
import { ErrorCodes } from "@/types/common";

vi.mock("@/database/attendanceRepository");
vi.mock("@/database/dutyRepository");
vi.mock("@/database/payoutRepository");
vi.mock("@/database/employeeRepository");
vi.mock("@/database/patientRepository");
vi.mock("@/services/dutyService", () => ({ dutyService: { checkIn: vi.fn() } }));
vi.mock("@/services/dutyDiaryService", () => ({ dutyDiaryService: {} }));
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "staff@test.com", accessToken: "tok" } };

const baseRow = {
  id: "ATT1",
  employee_id: "EMP1",
  status: "PRESENT",
  check_in_at: "2026-06-01T09:00:00.000+05:30",
  work_date: "2026-06-01",
  updated_at: "2026-06-01T12:00:00.000Z",
  hours: 8
};

describe("attendanceService manual writes (Phase 1 strict)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks PATCH even when concurrency token would otherwise match", async () => {
    vi.mocked(attendanceRepository.findById).mockResolvedValue({
      success: true,
      data: baseRow
    });

    const result = await attendanceService.update(
      "ATT1",
      {
        employee_id: "EMP1",
        status: "PRESENT",
        check_in_at: "2026-06-01T09:00:00.000+05:30",
        expected_updated_at: baseRow.updated_at
      },
      ctx
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ErrorCodes.business);
    expect(result.error).toContain(DUTY_CALENDAR_ATTENDANCE_SOT_MESSAGE.slice(0, 20));
    expect(attendanceRepository.update).not.toHaveBeenCalled();
  });

  it("blocks remove even when expected_updated_at is supplied", async () => {
    vi.mocked(attendanceRepository.findById).mockResolvedValue({
      success: true,
      data: baseRow
    });

    const result = await attendanceService.remove(
      "ATT1",
      ctx,
      { expected_updated_at: baseRow.updated_at }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ErrorCodes.business);
    expect(attendanceRepository.remove).not.toHaveBeenCalled();
  });

  it("blocks mark upsert path", async () => {
    vi.mocked(attendanceRepository.findByDutyAndEmployee).mockResolvedValue({
      success: true,
      data: { id: "ATT1" }
    });

    const result = await attendanceService.mark(
      {
        employee_id: "EMP1",
        duty_id: "DUTY1",
        status: "ABSENT",
        expected_updated_at: baseRow.updated_at
      },
      ctx
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe(ErrorCodes.business);
    expect(attendanceRepository.update).not.toHaveBeenCalled();
  });
});

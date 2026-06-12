import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceService } from "@/services/attendanceService";
import { attendanceRepository } from "@/database/attendanceRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { payoutRepository } from "@/database/payoutRepository";

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

describe("attendanceService optimistic concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns conflict when PATCH carries a stale expected_updated_at", async () => {
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
        expected_updated_at: "2020-01-01T00:00:00.000Z"
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(attendanceRepository.update).not.toHaveBeenCalled();
  });

  it("allows PATCH when expected_updated_at matches", async () => {
    const updatedAt = "2026-06-01T12:00:00.000Z";
    vi.mocked(attendanceRepository.findById)
      .mockResolvedValueOnce({
        success: true,
        data: { ...baseRow, updated_at: updatedAt }
      })
      .mockResolvedValueOnce({
        success: true,
        data: { ...baseRow, updated_at: updatedAt, notes: "ok" }
      });
    vi.mocked(attendanceRepository.update).mockResolvedValue({
      success: true,
      data: { ...baseRow, updated_at: updatedAt, notes: "ok" }
    });
    vi.mocked(attendanceRepository.findByDutyAndEmployee).mockResolvedValue({
      success: true,
      data: null
    });
    vi.mocked(payoutRepository.recomputeRpc).mockResolvedValue({ success: true, data: null });

    const result = await attendanceService.update(
      "ATT1",
      {
        employee_id: "EMP1",
        status: "PRESENT",
        check_in_at: "2026-06-01T09:00:00.000+05:30",
        notes: "ok",
        expected_updated_at: updatedAt
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(attendanceRepository.update).toHaveBeenCalled();
  });

  it("returns conflict on remove when expected_updated_at is stale", async () => {
    vi.mocked(attendanceRepository.findById).mockResolvedValue({
      success: true,
      data: baseRow
    });

    const result = await attendanceService.remove(
      "ATT1",
      ctx,
      { expected_updated_at: "2020-01-01T00:00:00.000Z" }
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("conflict");
    expect(attendanceRepository.remove).not.toHaveBeenCalled();
  });

  it("mark upsert update path forwards expected_updated_at to update", async () => {
    const updatedAt = "2026-06-01T12:00:00.000Z";
    vi.mocked(attendanceRepository.findByDutyAndEmployee).mockResolvedValue({
      success: true,
      data: { id: "ATT1" }
    });
    vi.mocked(attendanceRepository.findByEmployeeAndDate).mockResolvedValue({
      success: true,
      data: [{ id: "ATT1", employee_id: "EMP1", duty_id: "DUTY1", work_date: "2026-06-01" }]
    });
    vi.mocked(attendanceRepository.findById)
      .mockResolvedValueOnce({
        success: true,
        data: { ...baseRow, updated_at: updatedAt }
      })
      .mockResolvedValueOnce({
        success: true,
        data: { ...baseRow, updated_at: updatedAt, status: "ABSENT" }
      });
    vi.mocked(attendanceRepository.update).mockResolvedValue({
      success: true,
      data: { ...baseRow, updated_at: updatedAt, status: "ABSENT" }
    });
    vi.mocked(payoutRepository.recomputeRpc).mockResolvedValue({ success: true, data: null });

    const result = await attendanceService.mark(
      {
        employee_id: "EMP1",
        duty_id: "DUTY1",
        status: "ABSENT",
        expected_updated_at: updatedAt
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(attendanceRepository.update).toHaveBeenCalled();
  });
});

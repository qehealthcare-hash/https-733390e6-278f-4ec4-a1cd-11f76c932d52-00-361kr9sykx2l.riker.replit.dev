import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseEmployeeDetailDto } from "@/validation/employeeDto";
import { employeeDetailFixture } from "@/test/employeeDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/employeeService", () => ({
  employeeService: { getById: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { employeeService } from "@/services/employeeService";
import { GET as EmployeeByIdGet } from "../../../app/api/v1/employees/[id]/route";

const m = employeeService as unknown as { getById: ReturnType<typeof vi.fn> };

describe("EmployeeDetailDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/employees/[id] data satisfies EmployeeDetailDTO", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: employeeDetailFixture()
    });
    const res = await EmployeeByIdGet(
      makeRequest("GET", "/api/v1/employees/EMP2026050001"),
      ctx({ id: "EMP2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseEmployeeDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canEdit).toBe(true);
      expect(parsed.data.permissions.canDeactivate).toBe(true);
      expect(parsed.data.permissions.canActivate).toBe(false);
    }
  });

  it("returns activate-only flags for an Inactive employee", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: employeeDetailFixture({ status: "Inactive" })
    });
    const res = await EmployeeByIdGet(
      makeRequest("GET", "/api/v1/employees/EMP2026050001"),
      ctx({ id: "EMP2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parseEmployeeDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canEdit).toBe(false);
      expect(parsed.data.permissions.canDeactivate).toBe(false);
      expect(parsed.data.permissions.canActivate).toBe(true);
    }
  });
});

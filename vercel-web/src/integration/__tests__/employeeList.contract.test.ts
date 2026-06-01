import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseEmployeeDetailDto } from "@/validation/employeeDto";
import { employeeDetailFixture } from "@/test/employeeDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/employeeService", () => ({
  employeeService: { list: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { employeeService } from "@/services/employeeService";
import { GET as EmployeesGet } from "../../../app/api/v1/employees/route";

const m = employeeService as unknown as { list: ReturnType<typeof vi.fn> };

describe("EmployeeListDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/employees rows satisfy EmployeeDetailDTO including permissions", async () => {
    setActor(ACTORS.manager);
    m.list.mockResolvedValue({
      success: true,
      data: {
        rows: [
          employeeDetailFixture(),
          employeeDetailFixture({ id: "EMP2026050002", status: "Inactive" })
        ],
        total: 2
      }
    });
    const res = await EmployeesGet(makeRequest("GET", "/api/v1/employees"), ctx({}));
    const data = await expectOkEnvelope<{ rows: unknown[]; total: number }>(res);
    expect(data.total).toBe(2);

    for (const row of data.rows) {
      const parsed = parseEmployeeDetailDto(row);
      expect(parsed.success).toBe(true);
    }

    const active = parseEmployeeDetailDto(data.rows[0]);
    const inactive = parseEmployeeDetailDto(data.rows[1]);
    if (active.success) {
      expect(active.data.permissions.canEdit).toBe(true);
      expect(active.data.permissions.canDeactivate).toBe(true);
    }
    if (inactive.success) {
      expect(inactive.data.permissions.canEdit).toBe(false);
      expect(inactive.data.permissions.canActivate).toBe(true);
    }
  });
});

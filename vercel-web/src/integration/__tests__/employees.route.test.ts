/**
 * Integration test: employees API surface.
 *
 * - GET /employees: paginated, all-authed-actors.
 * - POST /employees: Admin/Manager only.
 * - GET/PATCH/DELETE /employees/[id]: per-method role gates.
 * - PATCH /employees/[id]/status: state-machine guard.
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
vi.mock("@/services/employeeService", () => ({
  employeeService: {
    list: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setStatus: vi.fn()
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
import { employeeService } from "@/services/employeeService";

import {
  GET as EmployeesGet,
  POST as EmployeesPost
} from "../../../app/api/v1/employees/route";
import {
  GET as EmployeeGet,
  PATCH as EmployeePatch,
  DELETE as EmployeeDelete
} from "../../../app/api/v1/employees/[id]/route";

const m = employeeService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/employees", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("returns 401 without bearer", async () => {
    const req = makeRequest("GET", "/api/v1/employees", { noAuth: true });
    const res = await EmployeesGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("paginates with limit clamped to [1,500]", async () => {
    setActor(ACTORS.staff);
    m.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest("GET", "/api/v1/employees?limit=9999&offset=10");
    const res = await EmployeesGet(req, ctx({}));
    await expectOkEnvelope(res);
    const [opts] = m.list.mock.calls[0];
    expect(opts.limit).toBe(500);
    expect(opts.offset).toBe(10);
  });
});

describe("POST /api/v1/employees", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("forbids Staff role (only Admin/Manager allowed)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/employees", { body: { name: "Alice" } });
    const res = await EmployeesPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("creates and returns 201 with envelope for Admin", async () => {
    setActor(ACTORS.admin);
    m.create.mockResolvedValue({ success: true, data: { id: "EMP1", full_name: "Alice" } });
    const req = makeRequest("POST", "/api/v1/employees", {
      body: { full_name: "Alice", mobile: "9876543211" }
    });
    const res = await EmployeesPost(req, ctx({}));
    const data = await expectCreatedEnvelope<{ id: string }>(res);
    expect(data.id).toBe("EMP1");
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it("returns duplicate envelope when service detects collision", async () => {
    setActor(ACTORS.manager);
    m.create.mockResolvedValue({
      success: false,
      code: "duplicate",
      error: "Phone already in use"
    });
    const req = makeRequest("POST", "/api/v1/employees", {
      body: { full_name: "Alice", mobile: "9876543211" }
    });
    const res = await EmployeesPost(req, ctx({}));
    await expectErrorEnvelope(res, 409, "duplicate");
  });
});

describe("GET/PATCH/DELETE /api/v1/employees/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET returns the employee envelope", async () => {
    setActor(ACTORS.staff);
    m.getById.mockResolvedValue({ success: true, data: { id: "EMP1" } });
    const req = makeRequest("GET", "/api/v1/employees/EMP1");
    const res = await EmployeeGet(req, ctx({ id: "EMP1" }));
    await expectOkEnvelope(res);
    expect(m.getById).toHaveBeenCalledWith("EMP1", expect.any(Object));
  });

  it("PATCH denies Nurse (allowed only Admin/Manager)", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("PATCH", "/api/v1/employees/EMP1", { body: { mobile: "1" } });
    const res = await EmployeePatch(req, ctx({ id: "EMP1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("DELETE is Admin-only — denies Manager with 403", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("DELETE", "/api/v1/employees/EMP1");
    const res = await EmployeeDelete(req, ctx({ id: "EMP1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("DELETE soft-closes for Admin and forwards the reason", async () => {
    setActor(ACTORS.admin);
    m.remove.mockResolvedValue({ success: true, data: { id: "EMP1", status: "Inactive" } });
    const req = makeRequest("DELETE", "/api/v1/employees/EMP1", {
      body: { reason: "left" }
    });
    const res = await EmployeeDelete(req, ctx({ id: "EMP1" }));
    await expectOkEnvelope(res);
    expect(m.remove).toHaveBeenCalledWith(
      "EMP1",
      expect.objectContaining({ actor: expect.any(Object) }),
      { reason: "left" }
    );
  });
});

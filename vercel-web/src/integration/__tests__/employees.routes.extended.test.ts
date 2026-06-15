/**
 * Integration test: employee API routes not covered by employees.route.test.ts
 * (M6 Pass A): status, links, sync.
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
    setStatus: vi.fn(),
    linkCounts: vi.fn(),
    syncLegacy: vi.fn()
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
import { employeeDetailFixture } from "@/test/employeeDetailFixture";
import { employeeService } from "@/services/employeeService";

import { POST as EmployeeStatusPost } from "../../../app/api/v1/employees/[id]/status/route";
import { GET as EmployeeLinksGet } from "../../../app/api/v1/employees/[id]/links/route";
import { POST as EmployeeSyncPost } from "../../../app/api/v1/employees/sync/route";

const m = employeeService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("POST /api/v1/employees/[id]/status", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/employees/EMP1/status", {
      body: { status: "Inactive", reason: "Left" }
    });
    const res = await EmployeeStatusPost(req, ctx({ id: "EMP1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.setStatus).not.toHaveBeenCalled();
  });

  it("forwards body to setStatus for Manager", async () => {
    setActor(ACTORS.manager);
    m.setStatus.mockResolvedValue({
      success: true,
      data: employeeDetailFixture({ id: "EMP1", status: "OnLeave" })
    });
    const req = makeRequest("POST", "/api/v1/employees/EMP1/status", {
      body: { status: "OnLeave", reason: "Medical" }
    });
    const res = await EmployeeStatusPost(req, ctx({ id: "EMP1" }));
    await expectOkEnvelope(res);
    expect(m.setStatus).toHaveBeenCalledWith(
      "EMP1",
      { status: "OnLeave", reason: "Medical" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) })
    );
  });
});

describe("GET /api/v1/employees/[id]/links", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("GET", "/api/v1/employees/EMP1/links");
    const res = await EmployeeLinksGet(req, ctx({ id: "EMP1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.linkCounts).not.toHaveBeenCalled();
  });

  it("permits Accountant", async () => {
    setActor(ACTORS.accountant);
    m.linkCounts.mockResolvedValue({
      success: true,
      data: { duties: 2, attendance: 1, payouts: 0, caretakerOf: 1 }
    });
    const req = makeRequest("GET", "/api/v1/employees/EMP1/links");
    const res = await EmployeeLinksGet(req, ctx({ id: "EMP1" }));
    await expectOkEnvelope(res);
    expect(m.linkCounts).toHaveBeenCalledWith(
      "EMP1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Accountant" }) })
    );
  });
});

describe("POST /api/v1/employees/sync", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/employees/sync", {
      body: { name: "Legacy", phone: "9876543210" }
    });
    const res = await EmployeeSyncPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.syncLegacy).not.toHaveBeenCalled();
  });

  it("permits Manager and forwards legacy payload", async () => {
    setActor(ACTORS.manager);
    m.syncLegacy.mockResolvedValue({
      success: true,
      data: { id: "EMP_LEGACY", status: "Active", name: "Legacy" }
    });
    const req = makeRequest("POST", "/api/v1/employees/sync", {
      body: { name: "Legacy", phone: "9876543210", status: "Active" }
    });
    const res = await EmployeeSyncPost(req, ctx({}));
    await expectOkEnvelope(res);
    expect(m.syncLegacy).toHaveBeenCalledWith(
      { name: "Legacy", phone: "9876543210", status: "Active" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) })
    );
  });
});

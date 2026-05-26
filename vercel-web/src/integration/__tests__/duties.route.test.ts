/**
 * Integration test: duties API surface.
 *
 * - GET /duties: requires an authed actor + listed role.
 * - POST /duties: role gate + service invocation.
 * - DELETE /duties/[id]: soft-cancel + Admin hard-delete branch.
 * - POST /duties/[id]/cancel: dedicated cancel endpoint.
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
vi.mock("@/services/dutyService", () => ({
  dutyService: {
    list: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    hardDelete: vi.fn(),
    extendActive: vi.fn()
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
import { dutyService } from "@/services/dutyService";

import {
  GET as DutiesGet,
  POST as DutiesPost
} from "../../../app/api/v1/duties/route";
import {
  DELETE as DutyDelete
} from "../../../app/api/v1/duties/[id]/route";
import { POST as DutyCancelPost } from "../../../app/api/v1/duties/[id]/cancel/route";

const m = dutyService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/duties", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires a permitted role (rejects Viewer)", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest(
      "GET",
      "/api/v1/duties?status=SCHEDULED&from=2026-05-01&to=2026-05-31"
    );
    const res = await DutiesGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.list).not.toHaveBeenCalled();
  });

  it("forwards filters to dutyService.list", async () => {
    setActor(ACTORS.staff);
    m.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest(
      "GET",
      "/api/v1/duties?employee_id=EMP1&patient_id=PAT1&status=SCHEDULED&from=2026-05-01&to=2026-05-31"
    );
    const res = await DutiesGet(req, ctx({}));
    await expectOkEnvelope(res);
    const [query] = m.list.mock.calls[0];
    expect(query).toMatchObject({
      employee_id: "EMP1",
      patient_id: "PAT1",
      status: "SCHEDULED",
      from: "2026-05-01",
      to: "2026-05-31"
    });
  });
});

describe("POST /api/v1/duties", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("rejects Nurse role with 403", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/duties", { body: {} });
    const res = await DutiesPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("creates a duty and returns 201", async () => {
    setActor(ACTORS.staff);
    m.create.mockResolvedValue({ success: true, data: { id: "DUTY1" } });
    const req = makeRequest("POST", "/api/v1/duties", {
      body: {
        patient_id: "PAT1",
        employee_id: "EMP1",
        start_at: "2026-05-25T08:00:00Z",
        end_at: "2026-05-26T08:00:00Z",
        service_name: "Care Taker",
        shift_type: "DAY",
        charge_per_day: 500,
        payout_per_day: 300
      }
    });
    const res = await DutiesPost(req, ctx({}));
    const data = await expectCreatedEnvelope<{ id: string }>(res);
    expect(data.id).toBe("DUTY1");
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it("propagates overlap conflict as 409", async () => {
    setActor(ACTORS.admin);
    m.create.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Duty overlaps an existing assignment"
    });
    const req = makeRequest("POST", "/api/v1/duties", { body: {} });
    const res = await DutiesPost(req, ctx({}));
    await expectErrorEnvelope(res, 409, "conflict");
  });
});

describe("DELETE /api/v1/duties/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("soft-cancels when ?hard is absent (Manager allowed)", async () => {
    setActor(ACTORS.manager);
    m.cancel.mockResolvedValue({
      success: true,
      data: { id: "DUTY1", status: "CANCELLED" }
    });
    const req = makeRequest("DELETE", "/api/v1/duties/DUTY1?reason=customer-cancel");
    const res = await DutyDelete(req, ctx({ id: "DUTY1" }));
    await expectOkEnvelope(res);
    expect(m.cancel).toHaveBeenCalledWith(
      "DUTY1",
      { reason: "customer-cancel" },
      expect.any(Object)
    );
    expect(m.hardDelete).not.toHaveBeenCalled();
  });

  it("requires Admin for ?hard=1", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("DELETE", "/api/v1/duties/DUTY1?hard=1");
    const res = await DutyDelete(req, ctx({ id: "DUTY1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.hardDelete).not.toHaveBeenCalled();
  });

  it("hard-deletes when Admin invokes ?hard=1", async () => {
    setActor(ACTORS.admin);
    m.hardDelete.mockResolvedValue({ success: true, data: { id: "DUTY1", removed: true } });
    const req = makeRequest("DELETE", "/api/v1/duties/DUTY1?hard=1");
    const res = await DutyDelete(req, ctx({ id: "DUTY1" }));
    await expectOkEnvelope(res);
    expect(m.hardDelete).toHaveBeenCalled();
  });
});

describe("POST /api/v1/duties/[id]/cancel", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff (only Admin/Manager allowed)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/duties/DUTY1/cancel", {
      body: { reason: "x" }
    });
    const res = await DutyCancelPost(req, ctx({ id: "DUTY1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.cancel).not.toHaveBeenCalled();
  });

  it("rejects cancel when receipts already recorded (409 conflict)", async () => {
    setActor(ACTORS.admin);
    m.cancel.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Receipts already recorded against this duty"
    });
    const req = makeRequest("POST", "/api/v1/duties/DUTY1/cancel", {
      body: { reason: "no-show" }
    });
    const res = await DutyCancelPost(req, ctx({ id: "DUTY1" }));
    await expectErrorEnvelope(res, 409, "conflict");
  });
});

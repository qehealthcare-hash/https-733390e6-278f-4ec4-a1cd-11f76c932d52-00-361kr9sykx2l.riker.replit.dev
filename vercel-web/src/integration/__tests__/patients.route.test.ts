/**
 * Integration test: patient API surface (M5 Pass A).
 *
 * - GET /patients: paginated list and bundle-shape passthrough.
 * - POST /patients: role gate (Admin/Manager/Staff/Executive), validation,
 *   service invocation with actor.
 * - GET /patients/[id]: single-row hydration.
 * - PATCH /patients/[id]: role gate + body forwarded to service.
 * - DELETE /patients/[id]: soft-close vs `?hard=1` Admin-only branch.
 * - POST /patients/[id]/assign: write-role gate + body forwarded.
 * - POST /patients/[id]/reopen: Admin/Manager-only + optional body.
 * - GET /patients/[id]/history: registry read then narrowed history cohort.
 * - POST /patients/sync: Admin/Manager-only legacy upsert.
 *
 * Service is mocked — business rules live in patientLifecycle.test.ts.
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
vi.mock("@/services/patientService", () => ({
  patientService: {
    list: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    removePermanent: vi.fn(),
    assignCaretaker: vi.fn(),
    reopen: vi.fn(),
    history: vi.fn(),
    syncLegacy: vi.fn()
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
import { patientService } from "@/services/patientService";

import {
  GET as PatientsGet,
  POST as PatientsPost
} from "../../../app/api/v1/patients/route";
import {
  GET as PatientGet,
  PATCH as PatientPatch,
  DELETE as PatientDelete
} from "../../../app/api/v1/patients/[id]/route";
import { POST as PatientAssignPost } from "../../../app/api/v1/patients/[id]/assign/route";
import { POST as PatientReopenPost } from "../../../app/api/v1/patients/[id]/reopen/route";
import { GET as PatientHistoryGet } from "../../../app/api/v1/patients/[id]/history/route";
import { POST as PatientSyncPost } from "../../../app/api/v1/patients/sync/route";

const mPatient = patientService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/patients", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const req = makeRequest("GET", "/api/v1/patients?limit=10", { noAuth: true });
    const res = await PatientsGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(mPatient.list).not.toHaveBeenCalled();
  });

  it("forwards query params to patientService.list and returns the rows envelope", async () => {
    setActor(ACTORS.manager);
    mPatient.list.mockResolvedValue({
      success: true,
      data: { rows: [{ id: "PAT1" }], total: 1 }
    });
    const req = makeRequest(
      "GET",
      "/api/v1/patients?limit=25&offset=50&q=anita&status=Active&caretaker_id=EMP9"
    );
    const res = await PatientsGet(req, ctx({}));
    const data = await expectOkEnvelope<{ rows: unknown[]; total: number }>(res);
    expect(data.rows).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(mPatient.list).toHaveBeenCalledTimes(1);
    const [query, opts] = mPatient.list.mock.calls[0];
    expect(query).toMatchObject({
      limit: "25",
      offset: "50",
      q: "anita",
      status: "Active",
      caretaker_id: "EMP9"
    });
    expect(opts.actor.role).toBe("Manager");
    expect(opts.actor.email).toBe(ACTORS.manager.email);
  });
});

describe("POST /api/v1/patients", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("rejects Nurse role with 403 forbidden", async () => {
    setActor(ACTORS.nurse);
    mPatient.create.mockResolvedValue({ success: true, data: { id: "PAT1" } });
    const req = makeRequest("POST", "/api/v1/patients", { body: { name: "A" } });
    const res = await PatientsPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.create).not.toHaveBeenCalled();
  });

  it("creates a patient and returns 201", async () => {
    setActor(ACTORS.staff);
    mPatient.create.mockResolvedValue({ success: true, data: { id: "PAT9", name: "Anita" } });
    const req = makeRequest("POST", "/api/v1/patients", {
      body: { name: "Anita", mobile: "9876543210" }
    });
    const res = await PatientsPost(req, ctx({}));
    const data = await expectCreatedEnvelope<{ id: string; name: string }>(res);
    expect(data.id).toBe("PAT9");
    expect(mPatient.create).toHaveBeenCalledWith(
      { name: "Anita", mobile: "9876543210" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Staff" }) })
    );
  });

  it("bubbles service validation failure as 422", async () => {
    setActor(ACTORS.admin);
    mPatient.create.mockResolvedValue({
      success: false,
      error: "Name is required",
      code: "validation_error",
      details: { fieldErrors: { name: ["Required"] } }
    });
    const req = makeRequest("POST", "/api/v1/patients", { body: {} });
    const res = await PatientsPost(req, ctx({}));
    const body = await expectErrorEnvelope(res, 422, "validation_error");
    expect(body.details).toEqual({ fieldErrors: { name: ["Required"] } });
  });

  it("rejects an invalid JSON body with 400", async () => {
    setActor(ACTORS.admin);
    const req = makeRequest("POST", "/api/v1/patients", { rawBody: "{not json" });
    const res = await PatientsPost(req, ctx({}));
    await expectErrorEnvelope(res, 400, "bad_request");
  });
});

describe("GET /api/v1/patients/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("returns 404 envelope when the service reports not_found", async () => {
    setActor(ACTORS.staff);
    mPatient.getById.mockResolvedValue({
      success: false,
      error: "Patient not found",
      code: "not_found"
    });
    const req = makeRequest("GET", "/api/v1/patients/PAT_MISSING");
    const res = await PatientGet(req, ctx({ id: "PAT_MISSING" }));
    await expectErrorEnvelope(res, 404, "not_found");
    expect(mPatient.getById).toHaveBeenCalledWith(
      "PAT_MISSING",
      expect.objectContaining({ actor: expect.any(Object) })
    );
  });

  it("returns the patient envelope on success", async () => {
    setActor(ACTORS.staff);
    mPatient.getById.mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Anita" }
    });
    const req = makeRequest("GET", "/api/v1/patients/PAT1");
    const res = await PatientGet(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ id: string; name: string }>(res);
    expect(data.id).toBe("PAT1");
  });
});

describe("PATCH /api/v1/patients/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies role outside the write set", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest("PATCH", "/api/v1/patients/PAT1", {
      body: { name: "New" }
    });
    const res = await PatientPatch(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.update).not.toHaveBeenCalled();
  });

  it("updates and returns the envelope when authorised", async () => {
    setActor(ACTORS.manager);
    mPatient.update.mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Anita Updated" }
    });
    const req = makeRequest("PATCH", "/api/v1/patients/PAT1", {
      body: { name: "Anita Updated" }
    });
    const res = await PatientPatch(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ name: string }>(res);
    expect(data.name).toBe("Anita Updated");
    expect(mPatient.update).toHaveBeenCalledWith(
      "PAT1",
      { name: "Anita Updated" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) })
    );
  });
});

describe("DELETE /api/v1/patients/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff for soft-close (Admin/Manager only)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("DELETE", "/api/v1/patients/PAT1", {
      body: { reason: "End of care" }
    });
    const res = await PatientDelete(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.remove).not.toHaveBeenCalled();
  });

  it("soft-closes when ?hard is absent and accepts a reason body", async () => {
    setActor(ACTORS.manager);
    mPatient.remove.mockResolvedValue({
      success: true,
      data: { id: "PAT1", status: "Closed" }
    });
    const req = makeRequest("DELETE", "/api/v1/patients/PAT1", {
      body: { reason: "End of care" }
    });
    const res = await PatientDelete(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ status: string }>(res);
    expect(data.status).toBe("Closed");
    expect(mPatient.remove).toHaveBeenCalledWith(
      "PAT1",
      expect.objectContaining({ actor: expect.any(Object) }),
      { reason: "End of care" }
    );
    expect(mPatient.removePermanent).not.toHaveBeenCalled();
  });

  it("permits ?hard=1 only for Admin", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("DELETE", "/api/v1/patients/PAT1?hard=1");
    const res = await PatientDelete(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.removePermanent).not.toHaveBeenCalled();
  });

  it("permanently removes when Admin invokes ?hard=1", async () => {
    setActor(ACTORS.admin);
    mPatient.removePermanent.mockResolvedValue({
      success: true,
      data: { id: "PAT1", removed: true }
    });
    const req = makeRequest("DELETE", "/api/v1/patients/PAT1?hard=1");
    const res = await PatientDelete(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ removed: boolean }>(res);
    expect(data.removed).toBe(true);
    expect(mPatient.removePermanent).toHaveBeenCalledWith(
      "PAT1",
      expect.objectContaining({ actor: expect.any(Object) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /patients/[id]/assign
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/patients/[id]/assign", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const req = makeRequest("POST", "/api/v1/patients/PAT1/assign", {
      body: { caretaker_id: "EMP1", shift: "DAY" },
      noAuth: true
    });
    const res = await PatientAssignPost(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(mPatient.assignCaretaker).not.toHaveBeenCalled();
  });

  it("denies Nurse (not in patient write set)", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/patients/PAT1/assign", {
      body: { caretaker_id: "EMP1", shift: "DAY" }
    });
    const res = await PatientAssignPost(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.assignCaretaker).not.toHaveBeenCalled();
  });

  it("forwards caretaker_id and shift to assignCaretaker", async () => {
    setActor(ACTORS.staff);
    mPatient.assignCaretaker.mockResolvedValue({
      success: true,
      data: { id: "PAT1", caretaker_id: "EMP1" }
    });
    const req = makeRequest("POST", "/api/v1/patients/PAT1/assign", {
      body: { caretaker_id: "EMP1", shift: "NIGHT" }
    });
    const res = await PatientAssignPost(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ caretaker_id: string }>(res);
    expect(data.caretaker_id).toBe("EMP1");
    expect(mPatient.assignCaretaker).toHaveBeenCalledWith(
      "PAT1",
      { caretaker_id: "EMP1", shift: "NIGHT" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Staff" }) })
    );
  });

  it("rejects an invalid JSON body with 400", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/patients/PAT1/assign", {
      rawBody: "{not json"
    });
    const res = await PatientAssignPost(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 400, "bad_request");
    expect(mPatient.assignCaretaker).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /patients/[id]/reopen
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/patients/[id]/reopen", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const req = makeRequest("POST", "/api/v1/patients/PAT1/reopen", {
      body: { reason: "Returned from hospital" },
      noAuth: true
    });
    const res = await PatientReopenPost(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(mPatient.reopen).not.toHaveBeenCalled();
  });

  it("denies Staff (reopen is Admin/Manager only)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/patients/PAT1/reopen", {
      body: { reason: "Returned" }
    });
    const res = await PatientReopenPost(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.reopen).not.toHaveBeenCalled();
  });

  it("forwards an optional reason body to reopen", async () => {
    setActor(ACTORS.manager);
    mPatient.reopen.mockResolvedValue({
      success: true,
      data: { id: "PAT1", status: "Active" }
    });
    const req = makeRequest("POST", "/api/v1/patients/PAT1/reopen", {
      body: { reason: "Family requested resume" }
    });
    const res = await PatientReopenPost(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ status: string }>(res);
    expect(data.status).toBe("Active");
    expect(mPatient.reopen).toHaveBeenCalledWith(
      "PAT1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) }),
      { reason: "Family requested resume" }
    );
  });

  it("tolerates an empty body (reopen without note)", async () => {
    setActor(ACTORS.admin);
    mPatient.reopen.mockResolvedValue({
      success: true,
      data: { id: "PAT1", status: "Active" }
    });
    const req = makeRequest("POST", "/api/v1/patients/PAT1/reopen");
    const res = await PatientReopenPost(req, ctx({ id: "PAT1" }));
    await expectOkEnvelope(res);
    expect(mPatient.reopen).toHaveBeenCalledWith(
      "PAT1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Admin" }) }),
      undefined
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /patients/[id]/history
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/patients/[id]/history", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const req = makeRequest("GET", "/api/v1/patients/PAT1/history", { noAuth: true });
    const res = await PatientHistoryGet(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(mPatient.history).not.toHaveBeenCalled();
  });

  it("denies Accountant (registry read but not history cohort)", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest("GET", "/api/v1/patients/PAT1/history");
    const res = await PatientHistoryGet(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.history).not.toHaveBeenCalled();
  });

  it("permits Nurse and forwards patient id", async () => {
    setActor(ACTORS.nurse);
    mPatient.history.mockResolvedValue({
      success: true,
      data: {
        patient: { id: "PAT1" },
        billings: [],
        receipts: [],
        duties: [],
        audits: [],
        linkCounts: { billings: 0, duties: 0 }
      }
    });
    const req = makeRequest("GET", "/api/v1/patients/PAT1/history");
    const res = await PatientHistoryGet(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ patient: { id: string } }>(res);
    expect(data.patient.id).toBe("PAT1");
    expect(mPatient.history).toHaveBeenCalledWith(
      "PAT1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Nurse" }) })
    );
  });

  it("permits Staff and returns the history bundle", async () => {
    setActor(ACTORS.staff);
    mPatient.history.mockResolvedValue({
      success: true,
      data: {
        patient: { id: "PAT1", name: "Anita" },
        billings: [{ id: "B1" }],
        receipts: [],
        duties: [],
        audits: [],
        linkCounts: { billings: 1, duties: 0 }
      }
    });
    const req = makeRequest("GET", "/api/v1/patients/PAT1/history");
    const res = await PatientHistoryGet(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ billings: unknown[] }>(res);
    expect(data.billings).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /patients/sync (legacy SPA upsert)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/patients/sync", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const req = makeRequest("POST", "/api/v1/patients/sync", {
      body: { name: "Legacy Patient", phone: "9876543210" },
      noAuth: true
    });
    const res = await PatientSyncPost(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(mPatient.syncLegacy).not.toHaveBeenCalled();
  });

  it("denies Staff (sync is Admin/Manager only)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/patients/sync", {
      body: { name: "Legacy Patient", phone: "9876543210" }
    });
    const res = await PatientSyncPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mPatient.syncLegacy).not.toHaveBeenCalled();
  });

  it("permits Manager and forwards the legacy payload", async () => {
    setActor(ACTORS.manager);
    mPatient.syncLegacy.mockResolvedValue({
      success: true,
      data: { id: "PAT_LEGACY_1", name: "Legacy Patient" }
    });
    const req = makeRequest("POST", "/api/v1/patients/sync", {
      body: { name: "Legacy Patient", phone: "9876543210", status: "Active" }
    });
    const res = await PatientSyncPost(req, ctx({}));
    const data = await expectOkEnvelope<{ id: string }>(res);
    expect(data.id).toBe("PAT_LEGACY_1");
    expect(mPatient.syncLegacy).toHaveBeenCalledWith(
      { name: "Legacy Patient", phone: "9876543210", status: "Active" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) })
    );
  });
});

/**
 * Integration test: patient API routes not covered by patients.route.test.ts
 * (M5 Pass A): assign, reopen, history, sync.
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
    assignCaretaker: vi.fn(),
    reopen: vi.fn(),
    history: vi.fn(),
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
import { patientService } from "@/services/patientService";

import { POST as PatientAssignPost } from "../../../app/api/v1/patients/[id]/assign/route";
import { POST as PatientReopenPost } from "../../../app/api/v1/patients/[id]/reopen/route";
import { GET as PatientHistoryGet } from "../../../app/api/v1/patients/[id]/history/route";
import { POST as PatientSyncPost } from "../../../app/api/v1/patients/sync/route";

const m = patientService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("POST /api/v1/patients/[id]/assign", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/patients/PAT1/assign", {
      body: { caretaker_id: "EMP1", shift: "DAY" }
    });
    const res = await PatientAssignPost(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.assignCaretaker).not.toHaveBeenCalled();
  });

  it("forwards body to assignCaretaker for Staff", async () => {
    setActor(ACTORS.staff);
    m.assignCaretaker.mockResolvedValue({
      success: true,
      data: { id: "PAT1", caretaker_id: "EMP1" }
    });
    const req = makeRequest("POST", "/api/v1/patients/PAT1/assign", {
      body: { caretaker_id: "EMP1", shift: "NIGHT" }
    });
    const res = await PatientAssignPost(req, ctx({ id: "PAT1" }));
    await expectOkEnvelope(res);
    expect(m.assignCaretaker).toHaveBeenCalledWith(
      "PAT1",
      { caretaker_id: "EMP1", shift: "NIGHT" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Staff" }) })
    );
  });
});

describe("POST /api/v1/patients/[id]/reopen", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff (reopen is Admin/Manager only)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/patients/PAT1/reopen", {
      body: { reason: "Returned" }
    });
    const res = await PatientReopenPost(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.reopen).not.toHaveBeenCalled();
  });

  it("permits Manager and forwards optional reason body", async () => {
    setActor(ACTORS.manager);
    m.reopen.mockResolvedValue({
      success: true,
      data: { id: "PAT1", status: "Active" }
    });
    const req = makeRequest("POST", "/api/v1/patients/PAT1/reopen", {
      body: { reason: "Returned from hospital" }
    });
    const res = await PatientReopenPost(req, ctx({ id: "PAT1" }));
    const data = await expectOkEnvelope<{ status: string }>(res);
    expect(data.status).toBe("Active");
    expect(m.reopen).toHaveBeenCalledWith(
      "PAT1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) }),
      { reason: "Returned from hospital" }
    );
  });
});

describe("GET /api/v1/patients/[id]/history", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Accountant (registry read only)", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest("GET", "/api/v1/patients/PAT1/history");
    const res = await PatientHistoryGet(req, ctx({ id: "PAT1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.history).not.toHaveBeenCalled();
  });

  it("permits Nurse and forwards id", async () => {
    setActor(ACTORS.nurse);
    m.history.mockResolvedValue({
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
    await expectOkEnvelope(res);
    expect(m.history).toHaveBeenCalledWith(
      "PAT1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Nurse" }) })
    );
  });
});

describe("POST /api/v1/patients/sync", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff (legacy sync is Admin/Manager only)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/patients/sync", {
      body: { name: "Legacy", phone: "9876543210" }
    });
    const res = await PatientSyncPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.syncLegacy).not.toHaveBeenCalled();
  });

  it("permits Manager and forwards legacy payload", async () => {
    setActor(ACTORS.manager);
    m.syncLegacy.mockResolvedValue({
      success: true,
      data: { id: "PAT_LEGACY", name: "Legacy" }
    });
    const req = makeRequest("POST", "/api/v1/patients/sync", {
      body: { name: "Legacy", phone: "9876543210", status: "Active" }
    });
    const res = await PatientSyncPost(req, ctx({}));
    const data = await expectOkEnvelope<{ id: string }>(res);
    expect(data.id).toBe("PAT_LEGACY");
    expect(m.syncLegacy).toHaveBeenCalledWith(
      { name: "Legacy", phone: "9876543210", status: "Active" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) })
    );
  });

  it("requires authentication", async () => {
    const req = makeRequest("POST", "/api/v1/patients/sync", {
      body: { name: "A", phone: "9876543210" },
      noAuth: true
    });
    const res = await PatientSyncPost(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(m.syncLegacy).not.toHaveBeenCalled();
  });
});

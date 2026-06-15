/**
 * Integration test: inquiry API surface (M4 Pass A).
 *
 * `auditsInquiries.route.test.ts` already covers `GET /inquiries` filter
 * forwarding and `POST /inquiries` Nurse-deny / Staff-201. This file adds
 * route-level coverage for the five remaining handlers that previously
 * had no test:
 *
 *   - GET    /inquiries/[id]          → REGISTRY_READ_ROLES gate + not_found
 *   - PATCH  /inquiries/[id]          → write-role gate + body forwarded
 *   - DELETE /inquiries/[id]          → soft default, ?hard=1 Admin-only,
 *                                       reason body forwarded
 *   - POST   /inquiries/[id]/status   → write-role gate + body forwarded
 *   - POST   /inquiries/[id]/convert  → write-role gate + body forwarded,
 *                                       Body-required guard
 *   - POST   /inquiries/sync          → Admin/Manager-only legacy upsert
 *
 * The service is mocked so we test the route surface (auth, role gate,
 * params/body wiring, envelope status). End-to-end business rules live
 * in src/services/__tests__/inquiryLifecycle.test.ts.
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
vi.mock("@/services/inquiryService", () => ({
  inquiryService: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setStatus: vi.fn(),
    convertToPatient: vi.fn(),
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
import { inquiryDetailFixture } from "@/test/inquiryDetailFixture";
import { inquiryService } from "@/services/inquiryService";

import {
  GET as InquiryGet,
  PATCH as InquiryPatch,
  DELETE as InquiryDelete
} from "../../../app/api/v1/inquiries/[id]/route";
import { POST as InquiryStatusPost } from "../../../app/api/v1/inquiries/[id]/status/route";
import { POST as InquiryConvertPost } from "../../../app/api/v1/inquiries/[id]/convert/route";
import { POST as InquirySyncPost } from "../../../app/api/v1/inquiries/sync/route";

const m = inquiryService as unknown as Record<string, ReturnType<typeof vi.fn>>;

// ─────────────────────────────────────────────────────────────────────────────
// GET /inquiries/[id]
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/inquiries/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const req = makeRequest("GET", "/api/v1/inquiries/INQ1", { noAuth: true });
    const res = await InquiryGet(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(m.getById).not.toHaveBeenCalled();
  });

  // M4-H1: previously Nurse could read inquiries via REGISTRY_READ_ROLES
  // (drift — frontend sidebar hid the link, server allowed direct URL).
  // After tightening INQUIRY_READ_ROLES to Admin/Manager/Executive/Staff,
  // Nurse is now correctly 403'd.
  it("denies Nurse (no longer in INQUIRY_READ_ROLES after H1 tighten)", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("GET", "/api/v1/inquiries/INQ1");
    const res = await InquiryGet(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.getById).not.toHaveBeenCalled();
  });

  it("denies Accountant (also tightened out by H1)", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest("GET", "/api/v1/inquiries/INQ1");
    const res = await InquiryGet(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.getById).not.toHaveBeenCalled();
  });

  it("permits Staff (in INQUIRY_READ_ROLES) and forwards id + actor", async () => {
    setActor(ACTORS.staff);
    m.getById.mockResolvedValue({
      success: true,
      data: inquiryDetailFixture({ id: "INQ1", patient_name: "Caller One", name: "Caller One" })
    });
    const req = makeRequest("GET", "/api/v1/inquiries/INQ1");
    const res = await InquiryGet(req, ctx({ id: "INQ1" }));
    const data = await expectOkEnvelope<{ id: string; patient_name: string }>(res);
    expect(data.id).toBe("INQ1");
    expect(m.getById).toHaveBeenCalledWith(
      "INQ1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Staff" }) })
    );
  });

  it("denies an unknown role with 403", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest("GET", "/api/v1/inquiries/INQ1");
    const res = await InquiryGet(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.getById).not.toHaveBeenCalled();
  });

  it("bubbles a not_found from the service as a 404 envelope", async () => {
    setActor(ACTORS.staff);
    m.getById.mockResolvedValue({
      success: false,
      error: "Inquiry not found",
      code: "not_found"
    });
    const req = makeRequest("GET", "/api/v1/inquiries/INQ_MISSING");
    const res = await InquiryGet(req, ctx({ id: "INQ_MISSING" }));
    await expectErrorEnvelope(res, 404, "not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /inquiries/[id]
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/v1/inquiries/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse (not in inquiry write set)", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("PATCH", "/api/v1/inquiries/INQ1", {
      body: { name: "Edited" }
    });
    const res = await InquiryPatch(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("denies an unknown role with 403", async () => {
    setActor(ACTORS.viewer);
    const req = makeRequest("PATCH", "/api/v1/inquiries/INQ1", {
      body: { name: "Edited" }
    });
    const res = await InquiryPatch(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("forwards id, body and actor to inquiryService.update", async () => {
    setActor(ACTORS.staff);
    m.update.mockResolvedValue({
      success: true,
      data: inquiryDetailFixture({ id: "INQ1", name: "Edited", patient_name: "Edited" })
    });
    const req = makeRequest("PATCH", "/api/v1/inquiries/INQ1", {
      body: { name: "Edited", area: "Satellite" }
    });
    const res = await InquiryPatch(req, ctx({ id: "INQ1" }));
    const data = await expectOkEnvelope<{ id: string; name: string }>(res);
    expect(data.id).toBe("INQ1");
    expect(m.update).toHaveBeenCalledWith(
      "INQ1",
      { name: "Edited", area: "Satellite" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Staff" }) })
    );
  });

  it("rejects an invalid JSON body with 400 bad_request", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("PATCH", "/api/v1/inquiries/INQ1", { rawBody: "{not json" });
    const res = await InquiryPatch(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 400, "bad_request");
    expect(m.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /inquiries/[id]
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/v1/inquiries/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff (only Admin/Manager may delete)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("DELETE", "/api/v1/inquiries/INQ1");
    const res = await InquiryDelete(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("soft-closes by default and forwards the reason body", async () => {
    setActor(ACTORS.manager);
    m.remove.mockResolvedValue({
      success: true,
      data: { id: "INQ1", mode: "soft" }
    });
    const req = makeRequest("DELETE", "/api/v1/inquiries/INQ1", {
      body: { reason: "Spam" }
    });
    const res = await InquiryDelete(req, ctx({ id: "INQ1" }));
    const data = await expectOkEnvelope<{ mode: string }>(res);
    expect(data.mode).toBe("soft");
    expect(m.remove).toHaveBeenCalledWith(
      "INQ1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) }),
      { reason: "Spam", hard: false }
    );
  });

  it("tolerates an absent body (DELETE without payload)", async () => {
    setActor(ACTORS.manager);
    m.remove.mockResolvedValue({
      success: true,
      data: { id: "INQ1", mode: "soft" }
    });
    const req = makeRequest("DELETE", "/api/v1/inquiries/INQ1");
    const res = await InquiryDelete(req, ctx({ id: "INQ1" }));
    await expectOkEnvelope(res);
    expect(m.remove).toHaveBeenCalledWith(
      "INQ1",
      expect.objectContaining({ actor: expect.any(Object) }),
      { reason: "", hard: false }
    );
  });

  it("forbids ?hard=1 for non-Admin (Manager)", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("DELETE", "/api/v1/inquiries/INQ1?hard=1");
    const res = await InquiryDelete(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("permits ?hard=1 for Admin and threads { hard: true } through", async () => {
    setActor(ACTORS.admin);
    m.remove.mockResolvedValue({
      success: true,
      data: { id: "INQ1", mode: "hard" }
    });
    const req = makeRequest("DELETE", "/api/v1/inquiries/INQ1?hard=1", {
      body: { reason: "Test data cleanup" }
    });
    const res = await InquiryDelete(req, ctx({ id: "INQ1" }));
    const data = await expectOkEnvelope<{ mode: string }>(res);
    expect(data.mode).toBe("hard");
    expect(m.remove).toHaveBeenCalledWith(
      "INQ1",
      expect.objectContaining({ actor: expect.objectContaining({ role: "Admin" }) }),
      { reason: "Test data cleanup", hard: true }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /inquiries/[id]/status
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/inquiries/[id]/status", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/inquiries/INQ1/status", {
      body: { status: "Contacted" }
    });
    const res = await InquiryStatusPost(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.setStatus).not.toHaveBeenCalled();
  });

  it("forwards { status, reason, followup_date } to setStatus", async () => {
    setActor(ACTORS.manager);
    m.setStatus.mockResolvedValue({
      success: true,
      data: inquiryDetailFixture({ id: "INQ1", status: "FollowUp" })
    });
    const req = makeRequest("POST", "/api/v1/inquiries/INQ1/status", {
      body: { status: "FollowUp", reason: "Family will call back", followup_date: "2026-06-15" }
    });
    const res = await InquiryStatusPost(req, ctx({ id: "INQ1" }));
    const data = await expectOkEnvelope<{ status: string }>(res);
    expect(data.status).toBe("FollowUp");
    expect(m.setStatus).toHaveBeenCalledWith(
      "INQ1",
      { status: "FollowUp", reason: "Family will call back", followup_date: "2026-06-15" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) })
    );
  });

  it("bubbles a service business-rule failure as 422 envelope", async () => {
    setActor(ACTORS.staff);
    m.setStatus.mockResolvedValue({
      success: false,
      error: "Converted inquiries are terminal — edit the linked patient instead",
      code: "business_rule_violation"
    });
    const req = makeRequest("POST", "/api/v1/inquiries/INQ1/status", {
      body: { status: "New" }
    });
    const res = await InquiryStatusPost(req, ctx({ id: "INQ1" }));
    // apiResultBridge maps both validation_error and business_rule_violation
    // to 422 (unprocessable_entity) since both are "the request was well-formed
    // but the domain rejected it".
    await expectErrorEnvelope(res, 422, "business_rule_violation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /inquiries/[id]/convert
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/inquiries/[id]/convert", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/inquiries/INQ1/convert", {
      body: {}
    });
    const res = await InquiryConvertPost(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.convertToPatient).not.toHaveBeenCalled();
  });

  it("requires a JSON body (P1-33 guard) — rejects empty body with 400", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/inquiries/INQ1/convert");
    // makeRequest will not add content-type for an empty body; force one so
    // the request reaches parseJsonBody (Next runtime requires text() to run).
    const res = await InquiryConvertPost(req, ctx({ id: "INQ1" }));
    await expectErrorEnvelope(res, 400, "bad_request");
    expect(m.convertToPatient).not.toHaveBeenCalled();
  });

  it("forwards id, body and actor to convertToPatient and returns 201", async () => {
    setActor(ACTORS.staff);
    m.convertToPatient.mockResolvedValue({
      success: true,
      data: {
        patient_id: "PID_FROM_INQ",
        inquiry_id: "INQ1",
        inquiry: { id: "INQ1", status: "Converted" },
        alreadyConverted: false
      }
    });
    const req = makeRequest("POST", "/api/v1/inquiries/INQ1/convert", {
      body: { notes: "Ready for admission" }
    });
    const res = await InquiryConvertPost(req, ctx({ id: "INQ1" }));
    const data = await expectCreatedEnvelope<{
      patient_id: string;
      alreadyConverted: boolean;
    }>(res);
    expect(data.patient_id).toBe("PID_FROM_INQ");
    expect(data.alreadyConverted).toBe(false);
    expect(m.convertToPatient).toHaveBeenCalledWith(
      "INQ1",
      { notes: "Ready for admission" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Staff" }) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /inquiries/sync (legacy SPA upsert)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/inquiries/sync", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff (sync is Admin/Manager only)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/inquiries/sync", {
      body: { name: "Caller", phone: "9876543210" }
    });
    const res = await InquirySyncPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.syncLegacy).not.toHaveBeenCalled();
  });

  it("permits Manager and forwards the legacy payload", async () => {
    setActor(ACTORS.manager);
    m.syncLegacy.mockResolvedValue({
      success: true,
      data: { id: "INQ_LEGACY_1", status: "New", name: "Caller" }
    });
    const req = makeRequest("POST", "/api/v1/inquiries/sync", {
      body: { name: "Caller", phone: "9876543210", status: "New" }
    });
    const res = await InquirySyncPost(req, ctx({}));
    const data = await expectOkEnvelope<{ id: string }>(res);
    expect(data.id).toBe("INQ_LEGACY_1");
    expect(m.syncLegacy).toHaveBeenCalledWith(
      { name: "Caller", phone: "9876543210", status: "New" },
      expect.objectContaining({ actor: expect.objectContaining({ role: "Manager" }) })
    );
  });

  it("requires authentication", async () => {
    const req = makeRequest("POST", "/api/v1/inquiries/sync", {
      body: { name: "A", phone: "9876543210" },
      noAuth: true
    });
    const res = await InquirySyncPost(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
    expect(m.syncLegacy).not.toHaveBeenCalled();
  });
});

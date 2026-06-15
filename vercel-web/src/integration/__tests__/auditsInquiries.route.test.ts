/**
 * Integration test: cross-cutting endpoints — audits and inquiries.
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
vi.mock("@/services/auditService", () => ({
  auditService: {
    list: vi.fn()
  }
}));
vi.mock("@/services/inquiryService", () => ({
  inquiryService: {
    list: vi.fn(),
    create: vi.fn()
  }
}));

import { auditRowFixture } from "@/test/auditRowFixture";
import { inquiryDetailFixture } from "@/test/inquiryDetailFixture";
import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { auditService } from "@/services/auditService";
import { inquiryService } from "@/services/inquiryService";

import { GET as AuditsGet } from "../../../app/api/v1/audits/route";
import {
  GET as InquiriesGet,
  POST as InquiriesPost
} from "../../../app/api/v1/inquiries/route";

const audit = auditService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const inq = inquiryService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/audits", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    const req = makeRequest("GET", "/api/v1/audits", { noAuth: true });
    const res = await AuditsGet(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("returns audit trail with filters threaded", async () => {
    setActor(ACTORS.manager);
    audit.list.mockResolvedValue({
      success: true,
      data: { rows: [auditRowFixture({ module: "patient", action: "create" })], total: 1 }
    });
    const req = makeRequest(
      "GET",
      "/api/v1/audits?module=patient&action=create&entity_id=PAT1&limit=20"
    );
    const res = await AuditsGet(req, ctx({}));
    const data = await expectOkEnvelope<{ rows: Array<{ module: string }> }>(res);
    expect(data.rows[0].module).toBe("patient");
    const [query] = audit.list.mock.calls[0];
    expect(query).toMatchObject({
      module: "patient",
      action: "create",
      entity_id: "PAT1",
      limit: "20"
    });
  });
});

describe("GET /api/v1/inquiries", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("forwards filters to inquiryService.list", async () => {
    setActor(ACTORS.staff);
    inq.list.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest(
      "GET",
      "/api/v1/inquiries?status=Open&assigned_to=USER1&open_only=true&source=Website"
    );
    const res = await InquiriesGet(req, ctx({}));
    await expectOkEnvelope(res);
    const [query] = inq.list.mock.calls[0];
    expect(query).toMatchObject({
      status: "Open",
      assigned_to: "USER1",
      open_only: "true",
      source: "Website"
    });
  });
});

describe("POST /api/v1/inquiries", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/inquiries", {
      body: { name: "Caller", mobile: "9999999999" }
    });
    const res = await InquiriesPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(inq.create).not.toHaveBeenCalled();
  });

  it("creates and returns 201 for Staff", async () => {
    setActor(ACTORS.staff);
    inq.create.mockResolvedValue({ success: true, data: inquiryDetailFixture({ id: "INQ1" }) });
    const req = makeRequest("POST", "/api/v1/inquiries", {
      body: { name: "Caller", mobile: "9999999999" }
    });
    const res = await InquiriesPost(req, ctx({}));
    const data = await expectCreatedEnvelope<{ id: string }>(res);
    expect(data.id).toBe("INQ1");
  });
});

/**
 * Integration test: settings API (M11 Pass A).
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
vi.mock("@/services/settingsService", () => ({
  settingsService: {
    listAll: vi.fn(),
    setKey: vi.fn(),
    deleteKey: vi.fn(),
    bulkSet: vi.fn()
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
import { settingsService } from "@/services/settingsService";

import { GET as SettingsGet, POST as SettingsPost } from "../../../app/api/v1/settings/route";
import {
  PUT as SettingsKeyPut,
  DELETE as SettingsKeyDelete
} from "../../../app/api/v1/settings/[key]/route";

const m = settingsService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/settings", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("allows Accountant read", async () => {
    setActor(ACTORS.accountant);
    m.listAll.mockResolvedValue({ success: true, data: { signatoryName: "Dr" } });
    const req = makeRequest("GET", "/api/v1/settings");
    const res = await SettingsGet(req, ctx({}));
    await expectOkEnvelope(res);
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("GET", "/api/v1/settings");
    const res = await SettingsGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.listAll).not.toHaveBeenCalled();
  });
});

describe("PUT /api/v1/settings/[key]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("allows Manager write", async () => {
    setActor(ACTORS.manager);
    m.setKey.mockResolvedValue({ success: true, data: { key: "company" } });
    const req = makeRequest("PUT", "/api/v1/settings/company", {
      body: { value: { name: "Hominal" } }
    });
    const res = await SettingsKeyPut(req, ctx({ key: "company" }));
    await expectOkEnvelope(res);
  });

  it("denies Accountant write", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest("PUT", "/api/v1/settings/company", {
      body: { value: {} }
    });
    const res = await SettingsKeyPut(req, ctx({ key: "company" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.setKey).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/settings/[key]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Manager", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("DELETE", "/api/v1/settings/company");
    const res = await SettingsKeyDelete(req, ctx({ key: "company" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.deleteKey).not.toHaveBeenCalled();
  });

  it("deletes for Admin", async () => {
    setActor(ACTORS.admin);
    m.deleteKey.mockResolvedValue({ success: true, data: { key: "company" } });
    const req = makeRequest("DELETE", "/api/v1/settings/company");
    const res = await SettingsKeyDelete(req, ctx({ key: "company" }));
    await expectOkEnvelope(res);
  });
});

describe("POST /api/v1/settings bulk", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("bulk set for Manager", async () => {
    setActor(ACTORS.manager);
    m.bulkSet.mockResolvedValue({ success: true, data: {} });
    const req = makeRequest("POST", "/api/v1/settings", { body: { company: { name: "X" } } });
    const res = await SettingsPost(req, ctx({}));
    await expectOkEnvelope(res);
  });
});

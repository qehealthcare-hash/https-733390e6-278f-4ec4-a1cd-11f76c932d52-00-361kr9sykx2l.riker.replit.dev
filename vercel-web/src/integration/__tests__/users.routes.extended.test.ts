/**
 * Integration test: users + roles API (M11 Pass A).
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
vi.mock("@/services/userService", () => ({
  userService: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    deactivateUser: vi.fn(),
    listRoles: vi.fn(),
    createRole: vi.fn()
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
import { userService } from "@/services/userService";

import {
  GET as UsersGet,
  POST as UsersPost
} from "../../../app/api/v1/users/route";
import {
  GET as UserByIdGet,
  PATCH as UserByIdPatch,
  DELETE as UserByIdDelete
} from "../../../app/api/v1/users/[id]/route";
import { GET as RolesGet, POST as RolesPost } from "../../../app/api/v1/roles/route";

const m = userService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/users", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("lists for Manager", async () => {
    setActor(ACTORS.manager);
    m.listUsers.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const req = makeRequest("GET", "/api/v1/users");
    const res = await UsersGet(req, ctx({}));
    await expectOkEnvelope(res);
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("GET", "/api/v1/users");
    const res = await UsersGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
  });
});

describe("POST /api/v1/users", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Manager create", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/users", {
      body: { email: "x@test.com", username: "x", role: "Staff" }
    });
    const res = await UsersPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it("creates for Admin", async () => {
    setActor(ACTORS.admin);
    m.createUser.mockResolvedValue({ success: true, data: { id: "U1" } });
    const req = makeRequest("POST", "/api/v1/users", {
      body: { email: "x@test.com", username: "x", role: "Staff" }
    });
    const res = await UsersPost(req, ctx({}));
    await expectCreatedEnvelope(res);
  });
});

describe("PATCH /api/v1/users/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Manager", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("PATCH", "/api/v1/users/U1", { body: { role: "Staff" } });
    const res = await UserByIdPatch(req, ctx({ id: "U1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
  });
});

describe("GET /api/v1/roles", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse (M11 H1 — roles list gated)", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("GET", "/api/v1/roles");
    const res = await RolesGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(m.listRoles).not.toHaveBeenCalled();
  });

  it("lists for Manager", async () => {
    setActor(ACTORS.manager);
    m.listRoles.mockResolvedValue({ success: true, data: { rows: [{ name: "Staff" }] } });
    const req = makeRequest("GET", "/api/v1/roles");
    const res = await RolesGet(req, ctx({}));
    await expectOkEnvelope(res);
  });
});

describe("POST /api/v1/roles", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Manager", async () => {
    setActor(ACTORS.manager);
    const req = makeRequest("POST", "/api/v1/roles", { body: { name: "Custom" } });
    const res = await RolesPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
  });
});

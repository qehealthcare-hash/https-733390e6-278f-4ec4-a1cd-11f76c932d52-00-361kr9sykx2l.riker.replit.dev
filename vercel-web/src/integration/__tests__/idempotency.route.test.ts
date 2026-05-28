/**
 * Integration test: Idempotency-Key replay on mutating routes.
 *
 * The middleware persists the first response in `hh_idempotency` keyed by
 * `(key, actor)`. Subsequent identical requests must replay the cached
 * envelope and *must not* invoke the service a second time, even when the
 * service mock is reconfigured to fail.
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
    remove: vi.fn()
  }
}));
vi.mock("@/services/dutyService", () => ({
  dutyService: {
    list: vi.fn(),
    create: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  makeRequest,
  resetIdempotencyStore,
  setActor
} from "@/test/routeHarness";
import { patientService } from "@/services/patientService";
import { dutyService } from "@/services/dutyService";

import { POST as PatientsPost } from "../../../app/api/v1/patients/route";
import { POST as DutiesPost } from "../../../app/api/v1/duties/route";

const mPatient = patientService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mDuty = dutyService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("Idempotency-Key replay", () => {
  beforeEach(() => {
    setActor(ACTORS.admin);
    // resetAllMocks clears both call history and the mockResolvedValueOnce
    // queue so unconsumed mocks from earlier tests cannot leak.
    vi.resetAllMocks();
    resetIdempotencyStore();
  });

  it("POST /patients with the same Idempotency-Key replays the cached envelope", async () => {
    mPatient.create.mockResolvedValueOnce({
      success: true,
      data: { id: "PAT1", name: "Anita" }
    });

    const key = "11111111-1111-4111-8111-111111111111";
    const req1 = makeRequest("POST", "/api/v1/patients", {
      body: { name: "Anita", mobile: "9000000001" },
      headers: { "idempotency-key": key }
    });
    const res1 = await PatientsPost(req1, ctx({}));
    const data1 = await expectCreatedEnvelope<{ id: string }>(res1);
    expect(data1.id).toBe("PAT1");
    expect(mPatient.create).toHaveBeenCalledTimes(1);

    // Even if the service would now fail, the second call must replay.
    mPatient.create.mockResolvedValueOnce({
      success: false,
      code: "internal_error",
      error: "should not be hit"
    });
    const req2 = makeRequest("POST", "/api/v1/patients", {
      body: { name: "Anita", mobile: "9000000001" },
      headers: { "idempotency-key": key }
    });
    const res2 = await PatientsPost(req2, ctx({}));
    expect(res2.status).toBe(201);
    expect(res2.headers.get("Idempotent-Replay")).toBe("true");
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.data.id).toBe("PAT1");
    expect(mPatient.create).toHaveBeenCalledTimes(1);
  });

  it("Different Idempotency-Keys run the service twice", async () => {
    mPatient.create
      .mockResolvedValueOnce({ success: true, data: { id: "PAT_A" } })
      .mockResolvedValueOnce({ success: true, data: { id: "PAT_B" } });

    for (const key of ["aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"]) {
      const req = makeRequest("POST", "/api/v1/patients", {
        body: { name: "X", mobile: "9000000002" },
        headers: { "idempotency-key": key }
      });
      await PatientsPost(req, ctx({}));
    }
    expect(mPatient.create).toHaveBeenCalledTimes(2);
  });

  it("No Idempotency-Key header → server synthesizes a key from actor+route+body-hash (P0-3)", async () => {
    // Pre-fix: the middleware short-circuited when no header was sent, so a
    // double-click became two writes. Post-fix: the server synthesizes a key
    // and dedupes anyway. Identical bodies from the same actor must collapse
    // to a single service call.
    mPatient.create
      .mockResolvedValueOnce({ success: true, data: { id: "A" } })
      .mockResolvedValueOnce({ success: true, data: { id: "WOULD_NEVER_BE_RETURNED" } });

    for (let i = 0; i < 2; i++) {
      const req = makeRequest("POST", "/api/v1/patients", {
        body: { name: "X", mobile: "9000000003" }
      });
      await PatientsPost(req, ctx({}));
    }
    expect(mPatient.create).toHaveBeenCalledTimes(1);
  });

  it("No Idempotency-Key header — different bodies still run the service once each (P0-3)", async () => {
    mPatient.create
      .mockResolvedValueOnce({ success: true, data: { id: "A" } })
      .mockResolvedValueOnce({ success: true, data: { id: "B" } });

    await PatientsPost(
      makeRequest("POST", "/api/v1/patients", { body: { name: "Alpha", mobile: "9000000010" } }),
      ctx({})
    );
    await PatientsPost(
      makeRequest("POST", "/api/v1/patients", { body: { name: "Beta", mobile: "9000000011" } }),
      ctx({})
    );
    expect(mPatient.create).toHaveBeenCalledTimes(2);
  });

  it("Per-actor scoping — same key from a different actor runs the service again", async () => {
    mDuty.create
      .mockResolvedValueOnce({ success: true, data: { id: "DUTY_A" } })
      .mockResolvedValueOnce({ success: true, data: { id: "DUTY_B" } });

    const key = "22222222-2222-4222-8222-222222222222";

    setActor(ACTORS.admin);
    await DutiesPost(
      makeRequest("POST", "/api/v1/duties", {
        body: {},
        headers: { "idempotency-key": key }
      }),
      ctx({})
    );

    setActor(ACTORS.manager);
    await DutiesPost(
      makeRequest("POST", "/api/v1/duties", {
        body: {},
        headers: { "idempotency-key": key }
      }),
      ctx({})
    );

    expect(mDuty.create).toHaveBeenCalledTimes(2);
  });

  it("Idempotency replays only when the original response was a success envelope", async () => {
    // First call fails (validation_error). The middleware still caches the
    // response, so a replay should return the same failure envelope without
    // hitting the service a second time.
    mPatient.create.mockResolvedValueOnce({
      success: false,
      code: "validation_error",
      error: "Name required"
    });

    const key = "33333333-3333-4333-8333-333333333333";
    const req1 = makeRequest("POST", "/api/v1/patients", {
      body: { mobile: "9000000004" },
      headers: { "idempotency-key": key }
    });
    const res1 = await PatientsPost(req1, ctx({}));
    expect(res1.status).toBe(422);

    mPatient.create.mockResolvedValueOnce({
      success: true,
      data: { id: "WOULD_NEVER_BE_RETURNED" }
    });
    const req2 = makeRequest("POST", "/api/v1/patients", {
      body: { mobile: "9000000004" },
      headers: { "idempotency-key": key }
    });
    const res2 = await PatientsPost(req2, ctx({}));
    expect(res2.status).toBe(422);
    expect(res2.headers.get("Idempotent-Replay")).toBe("true");
    expect(mPatient.create).toHaveBeenCalledTimes(1);
  });
});

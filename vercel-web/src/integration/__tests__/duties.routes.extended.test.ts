/**
 * Integration test: duty API routes not covered by duties.route.test.ts (M7 Pass A).
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
    getById: vi.fn(),
    update: vi.fn(),
    checkIn: vi.fn(),
    checkOut: vi.fn(),
    materialize: vi.fn(),
    assignPartners: vi.fn(),
    totalsFor: vi.fn(),
    extendActive: vi.fn()
  }
}));
vi.mock("@/services/dutyDiaryService", () => ({
  dutyDiaryService: {
    listDays: vi.fn(),
    listDaysBatch: vi.fn(),
    updateDay: vi.fn()
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
import { dutyDetailFixture } from "@/test/dutyDetailFixture";
import { dutyService } from "@/services/dutyService";
import { dutyDiaryService } from "@/services/dutyDiaryService";

import {
  GET as DutyGet,
  PATCH as DutyPatch
} from "../../../app/api/v1/duties/[id]/route";
import { POST as DutyCheckInPost } from "../../../app/api/v1/duties/[id]/check-in/route";
import { POST as DutyMaterializePost } from "../../../app/api/v1/duties/[id]/materialize/route";
import { GET as DutyDiaryGet } from "../../../app/api/v1/duties/[id]/diary/route";
import { POST as DutyDiaryBatchPost } from "../../../app/api/v1/duties/diary/batch/route";
import { GET as DutyTotalsGet } from "../../../app/api/v1/duties/totals/route";
import { POST as DutyExtendPost } from "../../../app/api/v1/duties/extend-active/route";

const mDuty = dutyService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mDiary = dutyDiaryService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("GET /api/v1/duties/[id]", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("permits Supervisor (M7 read parity)", async () => {
    setActor({ ...ACTORS.staff, role: "Supervisor", email: "supervisor@test.local" });
    mDuty.getById.mockResolvedValue({
      success: true,
      data: dutyDetailFixture({ id: "DUTY1" })
    });
    const req = makeRequest("GET", "/api/v1/duties/DUTY1");
    const res = await DutyGet(req, ctx({ id: "DUTY1" }));
    await expectOkEnvelope(res);
    expect(mDuty.getById).toHaveBeenCalled();
  });
});

describe("POST /api/v1/duties/[id]/check-in", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("permits Nurse", async () => {
    setActor(ACTORS.nurse);
    mDuty.checkIn.mockResolvedValue({
      success: true,
      data: dutyDetailFixture({ id: "DUTY1", status: "IN_PROGRESS" })
    });
    const req = makeRequest("POST", "/api/v1/duties/DUTY1/check-in", { body: {} });
    const res = await DutyCheckInPost(req, ctx({ id: "DUTY1" }));
    await expectOkEnvelope(res);
    expect(mDuty.checkIn).toHaveBeenCalled();
  });

  it("denies Executive (not in DUTY_CHECK_IN_ROLES)", async () => {
    setActor({ ...ACTORS.staff, role: "Executive", email: "executive@hominal.test" });
    const req = makeRequest("POST", "/api/v1/duties/DUTY1/check-in", { body: {} });
    const res = await DutyCheckInPost(req, ctx({ id: "DUTY1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mDuty.checkIn).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/duties/[id]/materialize", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Nurse", async () => {
    setActor(ACTORS.nurse);
    const req = makeRequest("POST", "/api/v1/duties/DUTY1/materialize", { body: {} });
    const res = await DutyMaterializePost(req, ctx({ id: "DUTY1" }));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mDuty.materialize).not.toHaveBeenCalled();
  });

  it("returns validated materialize stats for Manager", async () => {
    setActor(ACTORS.manager);
    mDuty.materialize.mockResolvedValue({
      success: true,
      data: {
        billing_id: "BIL2026050001",
        svc_key: "Care Taker Services",
        created_svc: 2,
        created_payout: 2,
        updated_svc: 0,
        updated_payout: 0,
        deleted_svc: 0,
        deleted_payout: 0,
        skipped: 0,
        days: 2
      }
    });
    const req = makeRequest("POST", "/api/v1/duties/DUTY1/materialize", { body: {} });
    const res = await DutyMaterializePost(req, ctx({ id: "DUTY1" }));
    const data = await expectOkEnvelope<{ created_svc: number }>(res);
    expect(data.created_svc).toBe(2);
    expect(mDuty.materialize).toHaveBeenCalled();
  });
});

describe("GET /api/v1/duties/[id]/diary", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("forwards to dutyDiaryService.listDays", async () => {
    setActor(ACTORS.staff);
    mDiary.listDays.mockResolvedValue({
      success: true,
      data: { duty_id: "DUTY1", entries: [] }
    });
    const req = makeRequest("GET", "/api/v1/duties/DUTY1/diary");
    const res = await DutyDiaryGet(req, ctx({ id: "DUTY1" }));
    await expectOkEnvelope(res);
    expect(mDiary.listDays).toHaveBeenCalledWith("DUTY1", expect.any(Object));
  });
});

describe("POST /api/v1/duties/diary/batch", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("permits Nurse for batched diary read", async () => {
    setActor(ACTORS.nurse);
    mDiary.listDaysBatch.mockResolvedValue({ success: true, data: {} });
    const req = makeRequest("POST", "/api/v1/duties/diary/batch", {
      body: { duty_ids: ["DUTY1", "DUTY2"] }
    });
    const res = await DutyDiaryBatchPost(req, ctx({}));
    await expectOkEnvelope(res);
    expect(mDiary.listDaysBatch).toHaveBeenCalled();
  });
});

describe("GET /api/v1/duties/totals", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Accountant", async () => {
    setActor(ACTORS.accountant);
    const req = makeRequest("GET", "/api/v1/duties/totals?patient_id=PAT1");
    const res = await DutyTotalsGet(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mDuty.totalsFor).not.toHaveBeenCalled();
  });

  it("returns validated totals for Manager", async () => {
    setActor(ACTORS.manager);
    mDuty.totalsFor.mockResolvedValue({
      success: true,
      data: {
        patient: {
          patient_id: "PAT1",
          bills: 1,
          billed: 5000,
          received: 2000,
          outstanding: 3000,
          sec_dep: 500
        },
        partner: null
      }
    });
    const req = makeRequest("GET", "/api/v1/duties/totals?patient_id=PAT1");
    const res = await DutyTotalsGet(req, ctx({}));
    const data = await expectOkEnvelope<{ patient: { outstanding: number } }>(res);
    expect(data.patient?.outstanding).toBe(3000);
  });
});

describe("POST /api/v1/duties/extend-active", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("denies Staff", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/duties/extend-active", { body: {} });
    const res = await DutyExtendPost(req, ctx({}));
    await expectErrorEnvelope(res, 403, "forbidden");
    expect(mDuty.extendActive).not.toHaveBeenCalled();
  });

  it("permits Manager", async () => {
    setActor(ACTORS.manager);
    mDuty.extendActive.mockResolvedValue({
      success: true,
      data: {
        processed: 2,
        created_svc: 1,
        created_payout: 1,
        updated_svc: 0,
        updated_payout: 0,
        deleted_svc: 0,
        deleted_payout: 0,
        skipped: 0,
        skipped_no_bill: 0,
        errors: []
      }
    });
    const req = makeRequest("POST", "/api/v1/duties/extend-active", { body: {} });
    const res = await DutyExtendPost(req, ctx({}));
    await expectOkEnvelope(res);
    expect(mDuty.extendActive).toHaveBeenCalled();
  });
});

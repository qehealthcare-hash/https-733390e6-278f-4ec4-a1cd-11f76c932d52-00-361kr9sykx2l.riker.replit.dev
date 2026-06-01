import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePatientDetailDto } from "@/validation/patientDto";
import { patientDetailFixture } from "@/test/patientDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/patientService", () => ({
  patientService: { list: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { patientService } from "@/services/patientService";
import { GET as PatientsGet } from "../../../app/api/v1/patients/route";

const m = patientService as unknown as { list: ReturnType<typeof vi.fn> };

describe("PatientListDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/patients rows satisfy PatientDetailDTO including permissions", async () => {
    setActor(ACTORS.manager);
    m.list.mockResolvedValue({
      success: true,
      data: {
        rows: [
          patientDetailFixture(),
          patientDetailFixture({ id: "PAT2026050002", status: "Closed" })
        ],
        total: 2
      }
    });
    const res = await PatientsGet(makeRequest("GET", "/api/v1/patients"), ctx({}));
    const data = await expectOkEnvelope<{ rows: unknown[]; total: number }>(res);
    expect(data.total).toBe(2);

    for (const row of data.rows) {
      const parsed = parsePatientDetailDto(row);
      expect(parsed.success).toBe(true);
    }

    const active = parsePatientDetailDto(data.rows[0]);
    const closed = parsePatientDetailDto(data.rows[1]);
    if (active.success) {
      expect(active.data.permissions.canEdit).toBe(true);
      expect(active.data.permissions.canClose).toBe(true);
    }
    if (closed.success) {
      expect(closed.data.permissions.canEdit).toBe(false);
      expect(closed.data.permissions.canReopen).toBe(true);
    }
  });
});

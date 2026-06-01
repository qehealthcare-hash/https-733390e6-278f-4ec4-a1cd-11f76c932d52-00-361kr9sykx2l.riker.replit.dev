import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePatientDetailDto } from "@/validation/patientDto";
import { patientDetailFixture } from "@/test/patientDetailFixture";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/patientService", () => ({
  patientService: { getById: vi.fn() }
}));

import {
  ACTORS,
  ctx,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { patientService } from "@/services/patientService";
import { GET as PatientByIdGet } from "../../../app/api/v1/patients/[id]/route";

const m = patientService as unknown as { getById: ReturnType<typeof vi.fn> };

describe("PatientDetailDTO contract", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("GET /api/v1/patients/[id] data satisfies PatientDetailDTO", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: patientDetailFixture()
    });
    const res = await PatientByIdGet(
      makeRequest("GET", "/api/v1/patients/PAT2026050001"),
      ctx({ id: "PAT2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parsePatientDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canEdit).toBe(true);
      expect(parsed.data.permissions.canAssignCaretaker).toBe(true);
      expect(parsed.data.permissions.canReopen).toBe(false);
    }
  });

  it("returns terminal permissions for a Deceased patient", async () => {
    setActor(ACTORS.manager);
    m.getById.mockResolvedValue({
      success: true,
      data: patientDetailFixture({ status: "Deceased" })
    });
    const res = await PatientByIdGet(
      makeRequest("GET", "/api/v1/patients/PAT2026050001"),
      ctx({ id: "PAT2026050001" })
    );
    const data = await expectOkEnvelope<Record<string, unknown>>(res);
    const parsed = parsePatientDetailDto(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.permissions.canEdit).toBe(false);
      expect(parsed.data.permissions.canAssignCaretaker).toBe(false);
      expect(parsed.data.permissions.canReopen).toBe(true);
    }
  });
});

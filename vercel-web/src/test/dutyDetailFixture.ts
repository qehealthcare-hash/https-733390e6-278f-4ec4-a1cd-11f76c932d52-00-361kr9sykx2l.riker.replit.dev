import { buildDutyPermissions } from "@/business/dutyRules";

/** Canonical DutyDetailDTO fixture for contract tests. */
export function dutyDetailFixture(overrides: Record<string, unknown> = {}) {
  const status = String((overrides.status as string | undefined) || "SCHEDULED");
  return {
    id: "DTY2026050001",
    employee_id: "EMP001",
    patient_id: "PAT001",
    service_type: "Care Taker Services",
    service_name: "Care Taker Services",
    shift_type: "DAY",
    start_at: "2026-05-12T03:30:00.000Z",
    end_at: "2026-05-12T15:30:00.000Z",
    status,
    cancel_reason: "",
    notes: "",
    billing_id: "BIL2026050001",
    charge_per_day: 1500,
    payout_per_day: 800,
    payout_term: "Daily",
    extra_partners: [],
    created_by: "manager@example.com",
    updated_by: "manager@example.com",
    created_at: "2026-05-01T05:00:00.000Z",
    updated_at: "2026-05-01T05:00:00.000Z",
    permissions: buildDutyPermissions({ status }),
    ...overrides
  };
}

import { buildInquiryPermissions } from "@/business/inquiryRules";

/** Canonical InquiryDetailDTO fixture for contract tests. */
export function inquiryDetailFixture(overrides: Record<string, unknown> = {}) {
  const status = String((overrides.status as string | undefined) || "New");
  const phone = String((overrides.phone as string | undefined) || "9999999999");
  return {
    id: "INQ2026050001",
    patient_name: "Test Patient",
    name: "Test Patient",
    mobile: phone,
    phone,
    wa: phone,
    area: "Ahmedabad",
    city: "Ahmedabad",
    address: "1 Test Lane",
    service_required: "Care Taker Services",
    service: "Care Taker Services",
    source: "WHATSAPP",
    potential: "WARM",
    emergency_level: 5,
    flexibility_score: 5,
    priority_score: 5,
    rating_emergency: 5,
    rating_flexibility: 5,
    rating_overall: 5,
    status,
    assigned_to: "manager@example.com",
    followup_date: "",
    notes: "",
    remarks: "",
    email: "",
    created_at: "2026-05-01T05:00:00.000Z",
    updated_at: "2026-05-01T05:00:00.000Z",
    patient_id: null,
    permissions: buildInquiryPermissions({ status, phone }),
    ...overrides
  };
}

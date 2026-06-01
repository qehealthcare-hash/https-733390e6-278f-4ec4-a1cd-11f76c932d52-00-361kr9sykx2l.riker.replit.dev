import { buildPatientPermissions } from "@/business/patientRules";

/** Canonical PatientDetailDTO fixture for contract tests. */
export function patientDetailFixture(overrides: Record<string, unknown> = {}) {
  const status = String((overrides.status as string | undefined) || "Active");
  return {
    id: "PAT2026050001",
    name: "Test Patient",
    full_name: "Test Patient",
    phone: "9999999999",
    mobile: "9999999999",
    dob: "",
    age: "62",
    gender: "Male",
    addr: "1 Test Lane",
    address: "1 Test Lane",
    area: "Ahmedabad",
    city: "Ahmedabad",
    pin: "380001",
    pincode: "380001",
    relname: "Kin",
    relphone: "9888888888",
    relname2: "",
    relphone2: "",
    relname3: "",
    relphone3: "",
    email: "",
    status,
    shift: "DAY",
    shift_type: "DAY",
    caretaker_id: "EMP001",
    assigned_staff_id: "EMP001",
    disease_condition: "",
    start_date: "2026-05-01",
    docs: [],
    patient_documents: [],
    photo: null,
    status_reason: "",
    status_reason_other: "",
    close_reason: "",
    created_at: "2026-05-01T05:00:00.000Z",
    updated_at: "2026-05-01T05:00:00.000Z",
    permissions: buildPatientPermissions({ status }),
    ...overrides
  };
}

/**
 * Doctor module UI helpers — form defaults and list row shape.
 */

export interface DoctorFormState {
  id: string;
  expected_updated_at: string;
  fn: string;
  ln: string;
  gender: string;
  phone: string;
  email: string;
  city: string;
  aadhar: string;
  pan: string;
  spec: string;
  qual: string;
  regno: string;
  regcouncil: string;
  regyear: string;
  clinic: string;
  clinicaddr: string;
  dob: string;
}

export interface DoctorListRow {
  id: string;
  updated_at?: string | null;
  fn?: string;
  ln?: string;
  gender?: string;
  phone?: string;
  email?: string;
  city?: string;
  aadhar?: string;
  pan?: string;
  spec?: string;
  qual?: string;
  regno?: string;
  regcouncil?: string;
  regyear?: string;
  clinic?: string;
  clinicaddr?: string;
  dob?: string;
}

export function catalogExpectedUpdatedAt(row: { updated_at?: string | null }): string {
  return row.updated_at ? String(row.updated_at) : "";
}

export { apiErrorMessage, isApiConflictError } from "@/lib/apiClientErrors";

export function emptyDoctorForm(): DoctorFormState {
  return {
    id: "",
    expected_updated_at: "",
    fn: "",
    ln: "",
    gender: "Male",
    phone: "",
    email: "",
    city: "Ahmedabad",
    aadhar: "",
    pan: "",
    spec: "",
    qual: "",
    regno: "",
    regcouncil: "",
    regyear: "",
    clinic: "",
    clinicaddr: "",
    dob: ""
  };
}

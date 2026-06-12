/**
 * Vendor module UI helpers — form defaults and list row shape.
 */

export interface VendorFormState {
  id: string;
  expected_updated_at: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  gst: string;
  pan: string;
  addr: string;
  city: string;
}

export interface VendorListRow {
  id: string;
  updated_at?: string | null;
  name?: string;
  contact?: string;
  phone?: string;
  email?: string;
  gst?: string;
  pan?: string;
  addr?: string;
  city?: string;
}

export function catalogExpectedUpdatedAt(row: { updated_at?: string | null }): string {
  return row.updated_at ? String(row.updated_at) : "";
}

export { apiErrorMessage, isApiConflictError } from "@/lib/apiClientErrors";

export function emptyVendorForm(): VendorFormState {
  return {
    id: "",
    expected_updated_at: "",
    name: "",
    contact: "",
    phone: "",
    email: "",
    gst: "",
    pan: "",
    addr: "",
    city: "Ahmedabad"
  };
}

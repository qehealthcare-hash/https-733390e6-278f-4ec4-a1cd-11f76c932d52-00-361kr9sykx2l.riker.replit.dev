import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import type { PatientInput } from "@/validation/patientValidation";
import { findPhoneDuplicate } from "@/business/phoneRules";

export function patientToRow(input: PatientInput) {
  const row: Record<string, unknown> = {
    name: input.name,
    phone: input.phone,
    dob: input.dob,
    gender: input.gender,
    blood: input.blood ?? "",
    addr: input.addr,
    area: input.area,
    city: input.city,
    pin: input.pin,
    relname: input.relname,
    relphone: input.relphone,
    relname2: input.relname2,
    relphone2: input.relphone2,
    relname3: input.relname3,
    relphone3: input.relphone3,
    email: input.email || "",
    status: input.status,
    shift: input.shift,
    caretaker_id: input.caretaker_id || null,
    age: input.age ?? "",
    disease_condition: input.disease_condition ?? "",
    start_date: input.start_date ?? "",
    docs: input.docs ?? undefined
  };
  if (Object.prototype.hasOwnProperty.call(input, "photo")) {
    row.photo = (input as { photo?: unknown }).photo ?? null;
  }
  const reason = (input as { status_reason?: string }).status_reason;
  if (reason !== undefined) row.status_reason = reason || "";
  const reasonOther = (input as { status_reason_other?: string }).status_reason_other;
  if (reasonOther !== undefined) row.status_reason_other = reasonOther || "";
  return row;
}

export function patientToApi(row: Record<string, unknown>) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name || "",
    full_name: row.name || "",
    phone: row.phone || "",
    mobile: row.phone || "",
    dob: row.dob || "",
    age: row.age || "",
    gender: row.gender || "",
    addr: row.addr || "",
    address: row.addr || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    pin: row.pin || "",
    pincode: row.pin || "",
    relname: row.relname || "",
    relphone: row.relphone || "",
    relname2: row.relname2 || "",
    relphone2: row.relphone2 || "",
    relname3: row.relname3 || "",
    relphone3: row.relphone3 || "",
    email: row.email || "",
    status: row.status || "Active",
    shift: row.shift || "",
    shift_type: row.shift || "",
    caretaker_id: row.caretaker_id || "",
    assigned_staff_id: row.caretaker_id || "",
    disease_condition: row.disease_condition || "",
    start_date: row.start_date || "",
    docs: row.docs || [],
    patient_documents: row.docs || [],
    photo: row.photo && typeof row.photo === "object" ? row.photo : null,
    status_reason: row.status_reason || "",
    status_reason_other: row.status_reason_other || "",
    close_reason: row.status_reason || "",
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

export function isActivePatient(status: string | undefined | null): boolean {
  return (status || "Active") === "Active";
}

export function findActivePatientDuplicate<
  T extends { id: string; phone?: string | null; status?: string | null }
>(candidates: T[], phone: string, excludeId?: string): T | null {
  return findPhoneDuplicate(candidates, phone, {
    excludeId,
    match: (r) => isActivePatient(r.status)
  });
}

/**
 * Normalised, case- and whitespace-insensitive comparison key for patient
 * names. Used by the name-similarity duplicate guard to catch the case where
 * the same person is re-registered with a different phone number.
 */
export function patientNameKey(name: string | null | undefined): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Locate an existing Active patient whose name matches `name` (case- and
 * whitespace-insensitive). Returns null when no match — including the
 * `excludeId` row (so updates don't false-positive against themselves).
 */
export function findActivePatientByName<
  T extends { id: string; name?: string | null; status?: string | null }
>(candidates: T[], name: string, excludeId?: string): T | null {
  const key = patientNameKey(name);
  if (!key) return null;
  for (const c of candidates) {
    if (excludeId && String(c.id) === excludeId) continue;
    if (!isActivePatient(c.status)) continue;
    if (patientNameKey(c.name) === key) return c;
  }
  return null;
}

/** Only registry-closed rows are read-only; legacy Duty Closed / Deceased etc. remain editable. */
export function isRegistryClosedPatient(status: string | undefined | null): boolean {
  return String(status || "") === "Closed";
}

export function canEditPatient(status: string | undefined | null): ApiResult<null> {
  if (isRegistryClosedPatient(status)) {
    return businessFailure("Closed patients are read-only — reopen before editing");
  }
  return businessOk();
}

export function canAssignCaretaker(status: string | undefined | null): ApiResult<null> {
  if (!isActivePatient(status)) {
    return businessFailure("Caretaker can only be assigned to an Active patient", { status });
  }
  return businessOk();
}

/**
 * Reopen is only meaningful for non-Active patients. Allows Closed / On Hold /
 * legacy statuses (Duty Closed, Deceased, etc.) to be flipped back to Active.
 */
export function canReopenPatient(status: string | undefined | null): ApiResult<null> {
  if (isActivePatient(status)) {
    return businessFailure("Patient is already active");
  }
  return businessOk();
}

/**
 * Hard-delete safety net. Patient must be soft-closed AND have no linked
 * billings / duties / receipts; otherwise the operator must clean those up
 * first or keep the soft-close (which preserves history).
 */
export function canHardDeletePatient(
  status: string | undefined | null,
  counts: { billings: number; duties: number; receipts: number }
): ApiResult<null> {
  if (isActivePatient(status)) {
    return businessFailure(
      "Active patients cannot be permanently deleted — close the patient first"
    );
  }
  const linked = [
    counts.billings > 0 ? `${counts.billings} billing(s)` : null,
    counts.duties > 0 ? `${counts.duties} duty record(s)` : null,
    counts.receipts > 0 ? `${counts.receipts} receipt(s)` : null
  ].filter(Boolean);
  if (linked.length) {
    return businessFailure(
      `Cannot permanently delete: patient still has ${linked.join(", ")}. ` +
        "Delete those first or keep the patient soft-closed to preserve history.",
      counts
    );
  }
  return businessOk();
}

export function patientClosePatch(
  actorEmail: string,
  reason?: string,
  reasonOther?: string
) {
  return {
    status: "Closed" as const,
    status_reason: reason || "",
    status_reason_other: reasonOther || "",
    updated_by: actorEmail
  };
}

export function patientReopenPatch(actorEmail: string) {
  return {
    status: "Active" as const,
    status_reason: "",
    status_reason_other: "",
    updated_by: actorEmail
  };
}

export function patientAssignPatch(caretakerId: string, shift: string, actorEmail: string) {
  return {
    caretaker_id: caretakerId,
    shift,
    updated_by: actorEmail
  };
}

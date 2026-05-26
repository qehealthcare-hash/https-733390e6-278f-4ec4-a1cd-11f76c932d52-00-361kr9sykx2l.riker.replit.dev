import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import type { InquiryInput, InquiryStatus } from "@/validation/inquiryValidation";
import {
  INQUIRY_CLOSED_SET,
  INQUIRY_OPEN_STATUSES,
  INQUIRY_STATUSES
} from "@/validation/inquiryValidation";
import { findPhoneDuplicate } from "@/business/phoneRules";

export type { InquiryStatus };
export { INQUIRY_STATUSES, INQUIRY_OPEN_STATUSES, INQUIRY_CLOSED_SET };

// ───────────────────────────────────────────────────────────────────────────
// Status predicates
// ───────────────────────────────────────────────────────────────────────────

export function isOpenInquiry(status: string | undefined | null): boolean {
  return !INQUIRY_CLOSED_SET.has(String(status || "") as InquiryStatus);
}

export function isClosedInquiry(status: string | undefined | null): boolean {
  return INQUIRY_CLOSED_SET.has(String(status || "") as InquiryStatus);
}

export function isConvertedInquiry(status: string | undefined | null): boolean {
  return String(status || "") === "Converted";
}

// ───────────────────────────────────────────────────────────────────────────
// Row mappers
// ───────────────────────────────────────────────────────────────────────────

/** Explicit allowlist DB row mapper — only known `hh_inquiries` columns. */
export function inquiryToRow(input: InquiryInput) {
  const row: Record<string, unknown> = {
    name: input.name,
    phone: input.phone,
    wa: input.wa,
    age: input.age,
    gender: input.gender,
    city: input.city,
    area: input.area,
    address: input.address,
    service: input.service,
    source: input.source,
    potential: input.potential,
    ...(input.status != null ? { status: input.status } : {}),
    assigned_to: input.assigned_to || null,
    followup_date: input.followup_date,
    notes: input.notes,
    remarks: input.remarks,
    email: input.email || ""
  };
  if (input.rating_emergency != null) row.rating_emergency = input.rating_emergency;
  if (input.rating_flexibility != null) row.rating_flexibility = input.rating_flexibility;
  if (input.rating_overall != null) row.rating_overall = input.rating_overall;
  return row;
}

/**
 * Fields to copy from an inquiry onto the linked patient after convert.
 * The DB RPC only seeds name/phone/address; this patch carries clinical +
 * contact metadata the registry form expects.
 */
export function inquiryToPatientPatch(inq: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const age = String(inq.age || "").trim();
  const gender = String(inq.gender || "").trim();
  const email = String(inq.email || "").trim();
  if (age) patch.age = age;
  if (gender) patch.gender = gender;
  if (email) patch.email = email;

  const service = String(inq.service || "").trim();
  const remarks = String(inq.remarks || inq.notes || "").trim();
  const diseaseParts = [service, remarks].filter(Boolean);
  if (diseaseParts.length) {
    patch.disease_condition = diseaseParts.join(" — ");
  }
  return patch;
}

/** Map raw row to the React/legacy UI shape (keeps page rendering working). */
export function inquiryToApi(row: Record<string, unknown>) {
  if (!row) return row;
  return {
    id: row.id,
    patient_name: row.name || "",
    name: row.name || "",
    mobile: row.phone || "",
    phone: row.phone || "",
    wa: row.wa || "",
    area: row.area || "",
    city: row.city || "Ahmedabad",
    address: row.address || "",
    service_required: row.service || "",
    service: row.service || "",
    source: String(row.source || "WHATSAPP").toUpperCase(),
    potential: String(row.potential || "WARM").toUpperCase(),
    emergency_level: Number(row.rating_emergency || 5),
    flexibility_score: Number(row.rating_flexibility || 5),
    priority_score: Number(row.rating_overall || 5),
    rating_emergency: Number(row.rating_emergency || 5),
    rating_flexibility: Number(row.rating_flexibility || 5),
    rating_overall: Number(row.rating_overall || 5),
    status: row.status || "New",
    assigned_to: row.assigned_to || "",
    followup_date: row.followup_date || "",
    notes: row.notes || row.remarks || "",
    remarks: row.remarks || "",
    email: row.email || "",
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null,
    patient_id: row.patient_id || null
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Duplicate detection
// ───────────────────────────────────────────────────────────────────────────

export function findOpenInquiryDuplicate<
  T extends { id: string; phone?: string | null; status?: string | null }
>(candidates: T[], phone: string, excludeId?: string): T | null {
  return findPhoneDuplicate(candidates, phone, {
    excludeId,
    match: (r) => isOpenInquiry(r.status)
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Status guards / transitions
// ───────────────────────────────────────────────────────────────────────────

/** Edits are allowed on any open inquiry. Closed inquiries are read-only
 *  except via an explicit reopen flow (handled by the status endpoint). */
export function canEditInquiry(status: string | undefined | null): ApiResult<null> {
  if (isConvertedInquiry(status)) {
    return businessFailure(
      "Converted inquiries are read-only — edit the linked patient instead"
    );
  }
  return businessOk();
}

export function canConvertInquiry(
  status: string | undefined | null,
  phone: string | undefined | null
): ApiResult<null> {
  if (isConvertedInquiry(status)) {
    return businessFailure("Inquiry has already been converted to a patient");
  }
  if (String(status || "") === "Closed" || String(status || "") === "Lost") {
    return businessFailure(
      `Cannot convert a ${status} inquiry — reopen it first`,
      { status }
    );
  }
  if (!phone || !phone.trim()) {
    return businessFailure("Inquiry has no mobile to dedupe");
  }
  return businessOk();
}

/** Allowed status transitions. Closed → Open requires an explicit reopen. */
export function canTransitionInquiryTo(
  current: string | null | undefined,
  next: InquiryStatus,
  hasReason: boolean
): ApiResult<null> {
  const from = String(current || "New") as InquiryStatus;
  if (from === next) return businessOk();

  // Once Converted, no further transitions — the patient is now the source of truth.
  if (from === "Converted") {
    return businessFailure(
      "Converted inquiries are terminal — edit the linked patient instead"
    );
  }
  // Reopening a Closed / Lost inquiry requires an audited reason.
  if ((from === "Closed" || from === "Lost") && !INQUIRY_CLOSED_SET.has(next) && !hasReason) {
    return businessFailure(
      `Reopening a ${from} inquiry requires a reason`,
      { from, to: next }
    );
  }
  return businessOk();
}

// ───────────────────────────────────────────────────────────────────────────
// Patches
// ───────────────────────────────────────────────────────────────────────────

export function inquiryStatusPatch(args: {
  status: InquiryStatus;
  reason?: string;
  followup_date?: string;
  actorEmail: string;
}) {
  const patch: Record<string, unknown> = {
    status: args.status,
    updated_by: args.actorEmail
  };
  if (args.followup_date !== undefined) {
    patch.followup_date = args.followup_date;
  }
  if (args.reason && args.reason.trim()) {
    patch.remarks = args.reason.trim();
  }
  return patch;
}

export function inquiryConvertPatch(actorEmail: string, notes?: string) {
  const patch: Record<string, unknown> = {
    status: "Converted",
    updated_by: actorEmail
  };
  if (notes && notes.trim()) patch.notes = notes.trim();
  return patch;
}

/** Soft-close patch (delete-with-history-preserving). */
export function inquiryClosePatch(actorEmail: string, reason = "") {
  const patch: Record<string, unknown> = {
    status: "Closed" as const,
    updated_by: actorEmail
  };
  if (reason.trim()) patch.remarks = reason.trim();
  return patch;
}

/** True when follow-up date is set and before today (YYYY-MM-DD compare). */
export function isOverdueFollowup(
  followupDate: string | null | undefined,
  status: string | null | undefined
): boolean {
  if (!followupDate || !String(followupDate).trim()) return false;
  if (isClosedInquiry(status)) return false;
  const d = Date.parse(String(followupDate).trim());
  if (Number.isNaN(d)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today.getTime();
}

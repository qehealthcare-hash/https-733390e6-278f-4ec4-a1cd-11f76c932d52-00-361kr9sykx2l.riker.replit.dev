import type { InquiryInput } from "@/validation/inquiryValidation";
import { findPhoneDuplicate } from "@/business/phoneRules";

const CLOSED_INQUIRY_STATUSES = new Set(["Converted", "Closed", "Lost"]);

export function isOpenInquiry(status: string | undefined | null): boolean {
  return !CLOSED_INQUIRY_STATUSES.has(String(status || ""));
}

export function inquiryToRow(input: InquiryInput) {
  return {
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
    rating_emergency: input.rating_emergency,
    rating_flexibility: input.rating_flexibility,
    rating_overall: input.rating_overall,
    status: input.status,
    assigned_to: input.assigned_to,
    followup_date: input.followup_date,
    notes: input.notes,
    remarks: input.remarks,
    email: input.email || ""
  };
}

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
    notes: row.notes || row.remarks || "",
    remarks: row.remarks || "",
    email: row.email || "",
    created_at: row.created_at || row.created || null,
    updated_at: row.updated_at || null
  };
}

export function findOpenInquiryDuplicate<
  T extends { id: string; phone?: string | null; status?: string | null }
>(candidates: T[], phone: string, excludeId?: string): T | null {
  return findPhoneDuplicate(candidates, phone, {
    excludeId,
    match: (r) => isOpenInquiry(r.status)
  });
}

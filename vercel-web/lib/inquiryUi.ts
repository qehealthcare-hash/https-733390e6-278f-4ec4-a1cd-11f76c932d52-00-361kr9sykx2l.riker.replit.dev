/**
 * Inquiry module UI helpers (M4 Pass D).
 *
 * Pure presentation utilities for the inquiries page — no API calls,
 * no business rules. Keeps the 900-line page focused on layout/state.
 */

import { appConfig } from "@/lib/config";
import { formatDate } from "@/lib/formatters";

/** Row shape returned by `inquiryToApi` (includes legacy SPA aliases). */
export interface InquiryListRow {
  id: string;
  patient_name?: string;
  name?: string;
  mobile?: string;
  phone?: string;
  area?: string;
  city?: string;
  service_required?: string;
  service?: string;
  source?: string;
  potential?: string;
  status?: string;
  assigned_to?: string;
  emergency_level?: number | null;
  rating_emergency?: number | null;
  flexibility_score?: number | null;
  rating_flexibility?: number | null;
  priority_score?: number | null;
  rating_overall?: number | null;
  followup_date?: string;
  notes?: string;
  remarks?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inquiryDisplayName(row: InquiryListRow): string {
  return row.patient_name || row.name || "";
}

export function inquiryPhone(row: InquiryListRow): string {
  return row.mobile || row.phone || "";
}

/** Absolute list position across paginated results (M4-L5). */
export function inquiryListPosition(
  page: number,
  pageSize: number,
  indexOnPage: number
): number {
  return (page - 1) * pageSize + indexOnPage + 1;
}

/** HTML body for `openPrintWindow` — user fields escaped (M4-L3). */
export function buildInquiryPdfBody(row: InquiryListRow, hideMobile: boolean): string {
  const name = escapeHtml(inquiryDisplayName(row));
  const mobile = escapeHtml(inquiryPhone(row));
  const area = escapeHtml(row.area || "");
  const city = escapeHtml(row.city || "");
  const service = escapeHtml(row.service_required || row.service || "");
  const source = escapeHtml(row.source || "");
  const potential = escapeHtml(row.potential || "");
  const status = escapeHtml(row.status || "");
  const emergency = row.emergency_level ?? row.rating_emergency ?? "-";
  const flexibility = row.flexibility_score ?? row.rating_flexibility ?? "-";
  const priority = row.priority_score ?? row.rating_overall ?? "-";
  const notes = escapeHtml(row.notes || row.remarks || "-");

  return [
    "<h2>Inquiry Summary</h2>",
    "<div class='meta'><strong>Patient:</strong> " + name + "</div>",
    hideMobile ? "" : "<div class='meta'><strong>Mobile:</strong> " + mobile + "</div>",
    "<div class='meta'><strong>Location:</strong> " + area + ", " + city + "</div>",
    "<div class='meta'><strong>Service Required:</strong> " + service + "</div>",
    "<div class='meta'><strong>Source:</strong> " + source + "</div>",
    "<div class='meta'><strong>Potential:</strong> " + potential + "</div>",
    "<div class='meta'><strong>Status:</strong> " + status + "</div>",
    "<table><thead><tr><th>Metric</th><th>Score</th></tr></thead><tbody>" +
      "<tr><td>Emergency Level</td><td>" +
      escapeHtml(emergency) +
      "/10</td></tr>" +
      "<tr><td>Flexibility</td><td>" +
      escapeHtml(flexibility) +
      "/10</td></tr>" +
      "<tr><td>Overall Priority</td><td>" +
      escapeHtml(priority) +
      "/10</td></tr>" +
      "</tbody></table>",
    "<div class='meta'><strong>Notes:</strong> " + notes + "</div>",
    "<div class='stamp'>Created/Processed on " + escapeHtml(formatDate(row.created_at)) + "</div>"
  ].join("");
}

/** WhatsApp deep-link using company config (M4-L4). */
export function buildInquiryWhatsAppUrl(row: InquiryListRow): string {
  const phoneDigits = inquiryPhone(row).replace(/\D/g, "");
  const text =
    "New Inquiry: " +
    inquiryDisplayName(row) +
    " needs " +
    (row.service_required || row.service || "") +
    " in " +
    (row.area || "") +
    ". Emergency: " +
    (row.emergency_level ?? row.rating_emergency ?? "-") +
    "/10. Please contact: " +
    inquiryPhone(row) +
    ". — " +
    appConfig.companyName +
    " | " +
    appConfig.companyPhone;
  return "https://wa.me/91" + phoneDigits + "?text=" + encodeURIComponent(text);
}

/**
 * Patient module UI helpers (M5 Pass D).
 *
 * Pure presentation utilities for the patients page — no API calls,
 * no business rules.
 */

import { formatDate, slugToText } from "@/lib/formatters";

/** Row shape from `patientToApi` / list endpoint (includes legacy aliases). */
export interface PatientListRow {
  id: string;
  full_name?: string;
  name?: string;
  dob?: string;
  age?: number | string;
  gender?: string;
  mobile?: string;
  phone?: string;
  address?: string;
  addr?: string;
  area?: string;
  city?: string;
  pincode?: string;
  pin?: string;
  shift_type?: string;
  shift?: string;
  caretaker_id?: string;
  assigned_staff_id?: string;
  disease_condition?: string;
  status?: string;
  status_reason?: string;
  close_reason?: string;
  start_date?: string;
  created_at?: string;
  registered_at?: string;
  relname?: string;
  relphone?: string;
  relname2?: string;
  relphone2?: string;
  relname3?: string;
  relphone3?: string;
  patient_documents?: PatientDocRef[];
  docs?: PatientDocRef[];
  photo?: PatientDocRef | null;
  updated_at?: string | null;
}

export interface PatientDocRef {
  path?: string;
  file_name?: string;
  mime_type?: string;
  signedUrl?: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function patientDisplayName(row: PatientListRow): string {
  return row.full_name || row.name || row.id;
}

export function patientPhone(row: PatientListRow): string {
  return row.mobile || row.phone || "";
}

/** Absolute list position across paginated results (M5-L5). */
export function patientListPosition(
  page: number,
  pageSize: number,
  indexOnPage: number
): number {
  return (page - 1) * pageSize + indexOnPage + 1;
}

function maskPhone(value: string): string {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 4) return "****";
  return "****" + s.slice(-4);
}

function isImageDoc(d: PatientDocRef): boolean {
  const m = String(d.mime_type || "").toLowerCase();
  if (m.indexOf("image/") === 0) return true;
  const n = String(d.file_name || d.path || "").toLowerCase();
  return /\.(jpe?g|png|webp|heic|heif|gif)$/.test(n);
}

function isPdfDoc(d: PatientDocRef): boolean {
  if (String(d.mime_type || "").toLowerCase() === "application/pdf") return true;
  const n = String(d.file_name || d.path || "").toLowerCase();
  return /\.pdf$/.test(n);
}

function pdfField(label: string, value: unknown): string {
  return (
    "<tr><th style='width:180px'>" +
    escapeHtml(label) +
    "</th><td>" +
    escapeHtml(value || "-") +
    "</td></tr>"
  );
}

/** HTML body for `openPrintWindow` — user fields escaped (M5-L3). */
export function buildPatientPdfBody(
  row: PatientListRow,
  hideSensitive: boolean,
  resolvedDocs: PatientDocRef[],
  resolvedPhoto: PatientDocRef | null | undefined,
  caretakerLabel: string
): string {
  const name = patientDisplayName(row);
  const rels = [
    { name: row.relname || "", phone: row.relphone || "" },
    { name: row.relname2 || "", phone: row.relphone2 || "" },
    { name: row.relname3 || "", phone: row.relphone3 || "" }
  ].filter((r) => r.name || r.phone);

  const phoneRaw = patientPhone(row);
  const rows = [
    pdfField("Patient ID", row.id),
    pdfField("Name", name),
    pdfField("Date of birth · age", [row.dob, row.age].filter(Boolean).join(" · ")),
    pdfField("Gender", row.gender),
    pdfField("Phone", hideSensitive ? maskPhone(phoneRaw) : phoneRaw),
    pdfField("Address", row.address || row.addr),
    pdfField(
      "Area · city · PIN",
      [row.area, row.city, row.pincode || row.pin].filter(Boolean).join(" · ")
    ),
    pdfField("Shift", slugToText(row.shift_type || row.shift || "")),
    pdfField("Assigned caretaker", caretakerLabel),
    pdfField("Disease / condition", row.disease_condition),
    pdfField("Status", row.status),
    pdfField("Status reason", row.status_reason || row.close_reason),
    pdfField("Start date", formatDate(row.start_date || row.created_at)),
    rels.length
      ? pdfField(
          "Relative contacts",
          rels.map((r) => r.name + (r.phone ? " · " + r.phone : "")).join(" | ")
        )
      : "",
    pdfField("Documents on file", String(resolvedDocs.length || 0))
  ].join("");

  const photoHtml =
    resolvedPhoto && resolvedPhoto.signedUrl
      ? "<div style='text-align:center;margin:8px 0 16px'><img src='" +
        escapeHtml(resolvedPhoto.signedUrl) +
        "' alt='Patient photo' style='max-width:160px;max-height:200px;border:1px solid #cbd5e1;border-radius:8px'/></div>"
      : "";

  let docsHtml = "";
  if (resolvedDocs.length) {
    docsHtml = "<h3>Attached documents (" + resolvedDocs.length + ")</h3><ol style='line-height:1.7'>";
    resolvedDocs.forEach((d) => {
      const nm = escapeHtml(d.file_name || d.path || "Document");
      const tag = isPdfDoc(d) ? "PDF" : isImageDoc(d) ? "IMG" : "FILE";
      const link = d.signedUrl
        ? "<a href='" +
          escapeHtml(d.signedUrl) +
          "' target='_blank' rel='noopener'>" +
          nm +
          "</a>"
        : nm;
      docsHtml += "<li>[" + tag + "] " + link + "</li>";
    });
    docsHtml += "</ol>";
    const imageDocs = resolvedDocs.filter((d) => isImageDoc(d) && d.signedUrl);
    if (imageDocs.length) {
      docsHtml +=
        "<h3>Document previews</h3>" +
        "<div style='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px'>" +
        imageDocs
          .map(
            (d) =>
              "<div style='border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center'>" +
              "<div style='font-size:12px;color:#475569;margin-bottom:6px'>" +
              escapeHtml(d.file_name || d.path) +
              "</div>" +
              "<img src='" +
              escapeHtml(d.signedUrl) +
              "' alt='" +
              escapeHtml(d.file_name || "doc") +
              "' style='max-width:100%;max-height:320px;object-fit:contain'/></div>"
          )
          .join("") +
        "</div>";
    }
  }

  return (
    "<h2>Patient Profile</h2>" + photoHtml + "<table><tbody>" + rows + "</tbody></table>" + docsHtml
  );
}

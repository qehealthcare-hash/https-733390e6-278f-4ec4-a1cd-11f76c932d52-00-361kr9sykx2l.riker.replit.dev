/**
 * Employee module UI helpers (M6 Pass D).
 *
 * Pure presentation utilities — no API calls, no business rules.
 */

import { formatCurrency, formatDate, slugToText } from "@/lib/formatters";
import type { EmployeePermissionsDto } from "@/validation/employeeDto";

export interface EmployeeDocRef {
  path?: string;
  file_name?: string;
  mime_type?: string;
  signedUrl?: string;
}

export interface EmployeeListRow {
  id: string;
  full_name?: string;
  name?: string;
  fn?: string;
  mn?: string;
  ln?: string;
  mobile?: string;
  phone?: string;
  phone2?: string;
  emp_type?: string;
  etype?: string;
  employee_type?: string;
  role?: string;
  desig?: string;
  dept?: string;
  department?: string;
  shift_type?: string;
  shift?: string;
  education?: string;
  edu?: string;
  skills?: string;
  area?: string;
  aadhar?: string;
  pan?: string;
  permaddr?: string;
  presaddr?: string;
  addr?: string;
  address?: string;
  pin?: string;
  pincode?: string;
  district?: string;
  state?: string;
  ecname?: string;
  ecphone?: string;
  ecrel?: string;
  score_experience?: number | null;
  score_behaviour?: number | null;
  score_testimonial?: number | null;
  score_total?: number | null;
  status?: string;
  active?: boolean;
  join_date?: string;
  join?: string;
  leave_date?: string;
  leave?: string;
  salary?: number;
  exp?: string;
  employee_documents?: EmployeeDocRef[];
  docs?: EmployeeDocRef[];
  photo?: EmployeeDocRef | null;
  updated_at?: string | null;
  gender?: string;
  dob?: string;
  joining_date?: string;
  relname?: string;
  relphone?: string;
  city?: string;
  permissions?: EmployeePermissionsDto;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function employeeDisplayName(row: EmployeeListRow): string {
  return (
    row.full_name ||
    row.name ||
    ((row.fn || "") + " " + (row.ln || "")).trim() ||
    row.id
  );
}

export function employeeListPosition(
  page: number,
  pageSize: number,
  indexOnPage: number
): number {
  return (page - 1) * pageSize + indexOnPage + 1;
}

export function rowScoreTotal(row: EmployeeListRow | null | undefined): number | null {
  if (row == null) return null;
  if (row.score_total != null && Number.isFinite(Number(row.score_total))) {
    return Number(row.score_total);
  }
  const parts = [row.score_experience, row.score_behaviour, row.score_testimonial]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!parts.length) return null;
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100;
}

function maskSensitive(value: string): string {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 4) return "****";
  return "****" + s.slice(-4);
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

function isImageDoc(d: EmployeeDocRef): boolean {
  const m = String(d.mime_type || "").toLowerCase();
  if (m.indexOf("image/") === 0) return true;
  const n = String(d.file_name || d.path || "").toLowerCase();
  return /\.(jpe?g|png|webp|heic|heif|gif)$/.test(n);
}

function isPdfDoc(d: EmployeeDocRef): boolean {
  if (String(d.mime_type || "").toLowerCase() === "application/pdf") return true;
  const n = String(d.file_name || d.path || "").toLowerCase();
  return /\.pdf$/.test(n);
}

/** HTML body for single-employee print (M6-L3). */
export function buildEmployeePdfBody(
  row: EmployeeListRow,
  hideSensitive: boolean,
  resolvedDocs: EmployeeDocRef[],
  resolvedPhoto: EmployeeDocRef | null | undefined
): string {
  const name = employeeDisplayName(row);
  const score = rowScoreTotal(row);
  const isActive = row.status ? row.status === "Active" : row.active !== false;
  const docCount = (row.employee_documents || row.docs || []).length;

  const rows = [
    pdfField("Employee ID", row.id),
    pdfField("Name", name),
    pdfField("Type", slugToText(row.emp_type || row.etype || row.employee_type || "")),
    pdfField("Designation", slugToText(row.role || row.desig || "")),
    pdfField("Department", slugToText(row.dept || row.department || "")),
    pdfField("Shift", slugToText(row.shift_type || row.shift || "")),
    pdfField("Education", slugToText(row.education || row.edu || "")),
    pdfField("Skills", row.skills),
    pdfField("Area", row.area),
    pdfField("Phone", hideSensitive ? "" : row.mobile || row.phone),
    pdfField("Alt phone", hideSensitive ? "" : row.phone2),
    pdfField("Aadhar", hideSensitive ? maskSensitive(String(row.aadhar || "")) : row.aadhar),
    pdfField("PAN", hideSensitive ? maskSensitive(String(row.pan || "")) : row.pan),
    pdfField("Permanent address", row.permaddr || row.addr || row.address),
    pdfField("Present address", row.presaddr),
    pdfField(
      "PIN · District · State",
      [row.pin || row.pincode, row.district, row.state].filter(Boolean).join(" · ")
    ),
    pdfField(
      "Emergency contact",
      row.ecname
        ? row.ecname +
          (row.ecphone ? " · " + row.ecphone : "") +
          (row.ecrel ? " (" + row.ecrel + ")" : "")
        : ""
    ),
    pdfField(
      "Performance score",
      score == null
        ? "Not rated"
        : score.toFixed(2) +
            " / 10  (Exp " +
            (row.score_experience ?? "-") +
            " · Beh " +
            (row.score_behaviour ?? "-") +
            " · Tst " +
            (row.score_testimonial ?? "-") +
            ")"
    ),
    pdfField("Status", (row.status || (isActive ? "Active" : "Inactive")) || "Active"),
    pdfField("Joining date", formatDate(row.join_date || row.join)),
    row.leave_date || row.leave
      ? pdfField("Leaving date", formatDate(row.leave_date || row.leave))
      : "",
    pdfField("Salary", row.salary ? formatCurrency(row.salary) + " /mo" : ""),
    pdfField("Experience", row.exp),
    pdfField("Documents on file", String(docCount))
  ].join("");

  const photoHtml =
    resolvedPhoto && resolvedPhoto.signedUrl
      ? "<div style='text-align:center;margin:8px 0 16px'><img src='" +
        escapeHtml(resolvedPhoto.signedUrl) +
        "' alt='Employee photo' style='max-width:160px;max-height:200px;border:1px solid #cbd5e1;border-radius:8px'/></div>"
      : "";

  let docsHtml = "";
  if (resolvedDocs.length) {
    docsHtml = "<h3>Attached documents (" + resolvedDocs.length + ")</h3><ol style='line-height:1.7'>";
    resolvedDocs.forEach((d) => {
      const nm = escapeHtml(d.file_name || d.path || "Document");
      const tag = isPdfDoc(d) ? "PDF" : isImageDoc(d) ? "IMG" : "FILE";
      const link = d.signedUrl
        ? "<a href='" + escapeHtml(d.signedUrl) + "' target='_blank' rel='noopener'>" + nm + "</a>"
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
    "<h2>Employee Profile</h2>" + photoHtml + "<table><tbody>" + rows + "</tbody></table>" + docsHtml
  );
}

/** Directory table HTML for filtered list print. */
export function buildEmployeeDirectoryPdfBody(rows: EmployeeListRow[]): string {
  const listRows = rows
    .map(function (row, index) {
      const name = employeeDisplayName(row);
      const score = rowScoreTotal(row);
      const isActive = row.status ? row.status === "Active" : row.active !== false;
      return (
        "<tr>" +
        "<td>" +
        (index + 1) +
        "</td>" +
        "<td>" +
        escapeHtml(row.id || "-") +
        "</td>" +
        "<td>" +
        escapeHtml(name || "-") +
        "</td>" +
        "<td>" +
        escapeHtml(slugToText(row.role || row.desig || "")) +
        "</td>" +
        "<td>" +
        escapeHtml(slugToText(row.dept || row.department || "")) +
        "</td>" +
        "<td>" +
        escapeHtml(slugToText(row.shift_type || row.shift || "")) +
        "</td>" +
        "<td>" +
        (score == null ? "—" : score.toFixed(1)) +
        "</td>" +
        "<td>" +
        escapeHtml(row.mobile || row.phone || "") +
        "</td>" +
        "<td>" +
        escapeHtml(row.status || (isActive ? "Active" : "Inactive")) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  return (
    "<h2>Employee Directory</h2>" +
    "<div class='meta'>" +
    rows.length +
    " staff · generated " +
    escapeHtml(formatDate(new Date().toISOString())) +
    "</div>" +
    "<table><thead><tr>" +
    "<th>#</th><th>ID</th><th>Name</th><th>Role</th><th>Dept</th><th>Shift</th><th>Score</th><th>Phone</th><th>Status</th>" +
    "</tr></thead><tbody>" +
    (listRows || "<tr><td colspan='9'>No employees match the current filters.</td></tr>") +
    "</tbody></table>"
  );
}

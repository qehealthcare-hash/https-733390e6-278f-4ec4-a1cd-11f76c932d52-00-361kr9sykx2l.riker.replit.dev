/**
 * Build a stable header list: explicit columns first, then any extra keys
 * discovered across rows (sorted) so exports stay predictable.
 */
function resolveHeaders(
  rows: Record<string, unknown>[],
  columns?: string[]
): string[] {
  if (columns && columns.length) return columns;
  const seen = new Set<string>();
  const headers: string[] = [];
  rows.forEach(function (row) {
    Object.keys(row || {}).forEach(function (key) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    });
  });
  return headers.sort();
}

/** CWE-1236: block spreadsheet formula injection from cell values starting with = + - @ */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value: string): string {
  if (CSV_FORMULA_PREFIX.test(value)) {
    return "'" + value;
  }
  return value;
}

function cellToCsvField(value: unknown): string {
  const normalized =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe = sanitizeCsvCell(normalized);
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function downloadCsv(
  fileName: string,
  rows: Record<string, unknown>[],
  columns?: string[]
): void {
  if (!rows || !rows.length) return;
  const headers = resolveHeaders(rows, columns);
  const lines = [headers.join(",")];
  rows.forEach(function (row) {
    lines.push(
      headers
        .map(function (header) {
          return cellToCsvField(row[header]);
        })
        .join(",")
    );
  });
  const csvBody = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csvBody], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

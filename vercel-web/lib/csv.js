/**
 * Build a stable header list: explicit columns first, then any extra keys
 * discovered across rows (sorted) so exports stay predictable.
 */
function resolveHeaders(rows, columns) {
  if (columns && columns.length) return columns;
  var seen = new Set();
  var headers = [];
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

export function downloadCsv(fileName, rows, columns) {
  if (!rows || !rows.length) return;
  var headers = resolveHeaders(rows, columns);
  var lines = [headers.join(",")];
  rows.forEach(function (row) {
    lines.push(
      headers
        .map(function (header) {
          var value = row[header];
          var normalized =
            value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
          return '"' + normalized.replace(/"/g, '""') + '"';
        })
        .join(",")
    );
  });
  var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  var url = window.URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

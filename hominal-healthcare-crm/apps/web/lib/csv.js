export function downloadCsv(fileName, rows) {
  if (!rows.length) return;
  var headers = Object.keys(rows[0]);
  var lines = [headers.join(",")];
  rows.forEach(function (row) {
    lines.push(
      headers
        .map(function (header) {
          var value = row[header];
          var normalized = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
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

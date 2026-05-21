(function () {
  var rows = Array.from(document.querySelectorAll("div")).filter(function (el) {
    var r = el.getBoundingClientRect();
    var text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (r.left < 130 || r.left > 190) return false;
    if (r.top < 430 || r.top > 1120) return false;
    if (r.width < 250 || r.width > 420) return false;
    if (r.height < 45 || r.height > 120) return false;
    if (text.indexOf("\u0aa8\u0aae\u0ab8\u0acd\u0aa4\u0ac7") !== -1) return false;
    if (!text || text.indexOf("Create ad") !== -1 || text.indexOf("You could get") !== -1) return false;
    if (text.indexOf("Manage") !== -1 || text.indexOf("Unread") !== -1) return false;
    return true;
  });
  rows.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
  var row = rows[0];
  if (!row) return "NO_ROW";
  row.scrollIntoView({ block: "center" });
  row.click();
  return "CLICKED:" + (row.innerText || row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
}());

(function () {
  var name = window.__fbConversationName;
  if (!name) return "NO_NAME";
  var candidates = Array.from(document.querySelectorAll("div, span")).filter(function (el) {
    var text = (el.innerText || el.textContent || "").trim();
    var rect = el.getBoundingClientRect();
    return text === name && rect.left > 100 && rect.left < 550 && rect.top > 250;
  });
  var el = candidates[0];
  if (!el) return "NOT_FOUND:" + name;
  var row = el;
  for (var i = 0; i < 8 && row.parentElement; i += 1) {
    var r = row.getBoundingClientRect();
    var text = (row.innerText || row.textContent || "").trim();
    if (r.width > 250 && r.height > 40 && text.indexOf(name) !== -1) break;
    row = row.parentElement;
  }
  row.scrollIntoView({ block: "center" });
  row.click();
  return "CLICKED:" + name;
}());

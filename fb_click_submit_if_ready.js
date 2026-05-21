(function () {
  var editor = Array.from(document.querySelectorAll('div[contenteditable="true"][role="textbox"], [role="textbox"][contenteditable="true"], textarea')).filter(function (el) {
    var r = el.getBoundingClientRect();
    return r.width > 200 && r.height > 10 && r.left > 400 && r.top > 500;
  }).sort(function (a, b) {
    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
  })[0];
  if (!editor) return "NO_EDITOR";
  var text = editor.innerText || editor.textContent || editor.value || "";
  if (text.indexOf("\u0aa8\u0aae\u0ab8\u0acd\u0aa4\u0ac7") < 0) return "NOT_READY:" + text.slice(0, 120);
  var button = Array.from(document.querySelectorAll('[role="button"], button')).find(function (b) {
    var label = (b.getAttribute("aria-label") || b.innerText || b.textContent || "").trim();
    return label === "Submit" || label === "Send";
  });
  if (!button) return "NO_SEND_BUTTON";
  button.click();
  return "SENT";
}());

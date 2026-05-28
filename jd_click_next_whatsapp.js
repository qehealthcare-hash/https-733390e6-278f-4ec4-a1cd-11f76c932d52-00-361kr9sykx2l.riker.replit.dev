(function () {
  var buttons = Array.from(document.querySelectorAll("button")).filter(function (b) {
    return ((b.innerText || b.getAttribute("aria-label") || "").indexOf("Send WhatsApp") >= 0);
  });
  if (typeof window.__jdWaIndex !== "number") window.__jdWaIndex = 1;
  var idx = window.__jdWaIndex;
  var button = buttons[idx];
  if (!button) return "NO_BUTTON:" + idx + "/" + buttons.length;
  window.__jdWaIndex = idx + 1;
  button.click();
  return "CLICKED:" + idx + "/" + buttons.length;
}());

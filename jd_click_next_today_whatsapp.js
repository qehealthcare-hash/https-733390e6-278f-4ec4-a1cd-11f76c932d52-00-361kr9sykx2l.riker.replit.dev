(function () {
  var buttons = Array.from(document.querySelectorAll("button")).filter(function (b) {
    return ((b.innerText || b.getAttribute("aria-label") || "").indexOf("Send WhatsApp") >= 0);
  });
  if (typeof window.__jdWaTodayIndex !== "number") window.__jdWaTodayIndex = 0;
  var idx = window.__jdWaTodayIndex;
  if (idx >= 8) return "DONE_TODAY:" + idx + "/" + buttons.length;
  var button = buttons[idx];
  if (!button) return "NO_BUTTON:" + idx + "/" + buttons.length;
  window.__jdWaTodayIndex = idx + 1;
  button.click();
  return "CLICKED_TODAY:" + idx + "/" + buttons.length;
}());

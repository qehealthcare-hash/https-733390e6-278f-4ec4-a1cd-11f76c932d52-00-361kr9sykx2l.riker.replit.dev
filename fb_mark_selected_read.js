(function () {
  var button = Array.from(document.querySelectorAll('[role="button"], button')).find(function (b) {
    var label = (b.getAttribute("aria-label") || b.innerText || b.textContent || "").replace(/\s+/g, " ").trim();
    return label === "Mark as read";
  });
  if (!button) return "NO_MARK_READ_BUTTON";
  button.click();
  return "MARKED_READ";
}());

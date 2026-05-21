(function () {
  return Array.from(document.querySelectorAll('[role="button"], button'))
    .slice(-50)
    .map(function (b, i) {
      return i + ": " + (b.getAttribute("aria-label") || b.innerText || b.textContent || "").replace(/\s+/g, " ").trim();
    })
    .join("\n");
}());

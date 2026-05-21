(function () {
  return Array.from(document.querySelectorAll('[aria-label="Send WhatsApp"]'))
    .slice(0, 20)
    .map(function (button, index) {
      var el = button;
      var best = "";
      for (var depth = 0; depth < 10 && el; depth += 1, el = el.parentElement) {
        var text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length > best.length) best = text;
      }
      return index + ": " + best.slice(0, 500);
    })
    .join("\n---\n");
}());

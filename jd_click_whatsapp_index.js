(function () {
  var i = window.__jdClickIndex || 0;
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[aria-label="Send WhatsApp"]'));
  var b = buttons[i];
  if (!b) return "missing";
  b.scrollIntoView({ block: "center" });
  b.click();
  return "clicked";
}());

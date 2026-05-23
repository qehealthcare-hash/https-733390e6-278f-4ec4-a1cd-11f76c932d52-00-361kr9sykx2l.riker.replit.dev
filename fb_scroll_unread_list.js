(function () {
  var candidates = Array.from(document.querySelectorAll("div")).filter(function (el) {
    var r = el.getBoundingClientRect();
    return r.left < 540 && r.top > 230 && r.bottom < window.innerHeight &&
      el.scrollHeight > el.clientHeight + 80;
  });
  if (!candidates.length) return "NO_SCROLL_CONTAINER";
  var changed = false;
  var parts = candidates.map(function (el) {
    var before = el.scrollTop;
    el.scrollTop = Math.min(el.scrollTop + 560, el.scrollHeight);
    if (el.scrollTop !== before) changed = true;
    return before + "->" + el.scrollTop + "/" + el.scrollHeight;
  });
  return (changed ? "SCROLLED:" : "AT_END:") + parts.join(",");
}());

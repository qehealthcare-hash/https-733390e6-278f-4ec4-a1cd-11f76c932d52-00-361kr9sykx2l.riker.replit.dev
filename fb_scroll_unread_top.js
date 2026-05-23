(function () {
  var candidates = Array.from(document.querySelectorAll("div")).filter(function (el) {
    var r = el.getBoundingClientRect();
    return r.left < 540 && r.top > 230 && r.bottom < window.innerHeight &&
      el.scrollHeight > el.clientHeight + 80;
  });
  if (!candidates.length) return "NO_SCROLL_CONTAINER";
  var before = candidates.map(function (el) { return el.scrollTop; }).join(",");
  candidates.forEach(function (el) { el.scrollTop = 0; });
  var after = candidates.map(function (el) { return el.scrollTop; }).join(",");
  return "TOP:" + before + "->" + after;
}());

(function () {
  var candidates = Array.from(document.querySelectorAll("div")).filter(function (el) {
    var r = el.getBoundingClientRect();
    return r.left < 540 && r.top > 230 && r.bottom < window.innerHeight &&
      el.scrollHeight > el.clientHeight + 80;
  });
  candidates.sort(function (a, b) {
    return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
  });
  var el = candidates[0];
  if (!el) return "NO_SCROLL_CONTAINER";
  var before = el.scrollTop;
  el.scrollTop = 0;
  return "TOP:" + before + "->" + el.scrollTop + "/" + el.scrollHeight;
}());

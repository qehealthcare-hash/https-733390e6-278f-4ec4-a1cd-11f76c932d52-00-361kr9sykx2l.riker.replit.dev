(function () {
  function dump(o, depth, seen) {
    if (!o || depth > 5) return null;
    if (seen.indexOf(o) >= 0) return null;
    seen.push(o);
    var out = {};
    for (var k in o) {
      try {
        var v = o[k];
        if (/mobile|phone|lead|jduid|name|whatsapp|mbl|cont|user|data|props/i.test(k)) {
          out[k] = typeof v === "object" ? dump(v, depth + 1, seen) : String(v).slice(0, 300);
        }
      } catch (e) {}
    }
    return out;
  }
  var b = document.querySelector('[aria-label="Send WhatsApp"]');
  var n = b;
  var res = [];
  while (n && res.length < 12) {
    var keys = Object.keys(n).filter(function (k) {
      return k.indexOf("__react") >= 0;
    });
    res.push({
      tag: n.tagName,
      cls: String(n.className || "").slice(0, 120),
      text: (n.innerText || n.textContent || "").replace(/\s+/g, " ").slice(0, 120),
      keys: keys,
      data: keys.map(function (k) { return dump(n[k], 0, []); })
    });
    n = n.parentElement;
  }
  return JSON.stringify(res).slice(0, 20000);
}());

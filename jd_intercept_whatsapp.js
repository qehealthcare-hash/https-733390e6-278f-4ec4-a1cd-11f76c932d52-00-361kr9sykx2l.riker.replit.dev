(function () {
  window.__jdOpenUrls = [];
  window.__jdOldOpen = window.open;
  window.open = function (url) {
    window.__jdOpenUrls.push(String(url || ""));
    return null;
  };
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[aria-label="Send WhatsApp"]'));
  for (var i = 0; i < buttons.length; i += 1) {
    try {
      buttons[i].scrollIntoView({ block: "center" });
      buttons[i].click();
    } catch (e) {
      window.__jdOpenUrls.push("ERR:" + i + ":" + e.message);
    }
  }
  window.open = window.__jdOldOpen;
  return JSON.stringify(window.__jdOpenUrls);
}());

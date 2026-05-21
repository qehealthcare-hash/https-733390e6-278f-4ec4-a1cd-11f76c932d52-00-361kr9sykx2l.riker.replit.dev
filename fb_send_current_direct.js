(function () {
  var message = "\u0aa8\u0aae\u0ab8\u0acd\u0aa4\u0ac7 \ud83d\ude4f\n\u0ab9\u0abe\u0ab2 \u0a85\u0aae\u0aa8\u0ac7 Care Taker \u0aa8\u0ac0 \u0a9c\u0ab0\u0ac2\u0ab0 \u0a9b\u0ac7.\n\u0a9c\u0acb \u0aa4\u0aae\u0aa8\u0ac7 \u0a85\u0aa5\u0ab5\u0abe \u0aa4\u0aae\u0abe\u0ab0\u0abe \u0a93\u0ab3\u0a96\u0ac0\u0aa4\u0abe\u0aae\u0abe\u0a82 \u0a95\u0acb\u0a88\u0aa8\u0ac7 \u0a95\u0abe\u0aae \u0a95\u0ab0\u0ab5\u0ac1\u0a82 \u0ab9\u0acb\u0aaf \u0aa4\u0acb \u0a95\u0ac3\u0aaa\u0abe \u0a95\u0ab0\u0ac0\u0aa8\u0ac7 \u0ab8\u0a82\u0aaa\u0ab0\u0acd\u0a95 \u0a95\u0ab0\u0acb.\n\ud83d\udcde Mo.: 7211136600 / 9722629241";
  var editor = Array.from(document.querySelectorAll('div[contenteditable="true"][role="textbox"], [role="textbox"][contenteditable="true"], textarea')).filter(function (el) {
    var r = el.getBoundingClientRect();
    return r.width > 200 && r.height > 10 && r.left > 400 && r.top > 500;
  }).sort(function (a, b) {
    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
  })[0];
  if (!editor) return "NO_EDITOR";
  editor.focus();
  if (editor.tagName === "TEXTAREA") {
    editor.value = "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.value = message;
  } else {
    var range = document.createRange();
    range.selectNodeContents(editor);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, message);
  }
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  var text = editor.innerText || editor.textContent || "";
  if (text.indexOf("\u0aa8\u0aae\u0ab8\u0acd\u0aa4\u0ac7") < 0) return "NOT_READABLE:" + text.slice(0, 200);
  var button = Array.from(document.querySelectorAll('[role="button"], button')).find(function (b) {
    var label = (b.getAttribute("aria-label") || b.innerText || b.textContent || "").trim();
    return label === "Submit" || label === "Send";
  });
  if (!button) return "NO_SEND_BUTTON";
  button.click();
  return "SENT";
}());

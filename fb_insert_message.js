(function () {
  var message = "નમસ્તે 🙏\nહાલ અમને Care Taker ની જરૂર છે.\nજો તમને અથવા તમારા ઓળખીતામાં કોઈને કામ કરવું હોય તો કૃપા કરીને સંપર્ક કરો.\n📞 Mo.: 7211136600 / 9722629241";
  var editor = document.querySelector('div[contenteditable="true"][role="textbox"], [role="textbox"][contenteditable="true"], textarea');
  if (!editor) return "NO_EDITOR";
  editor.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, message);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message }));
  return editor.innerText || editor.textContent || "INSERTED";
}());

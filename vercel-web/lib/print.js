import { appConfig } from "./config";

export function openPrintWindow(title, bodyHtml, preOpened) {
  // P1-32: callers that fetch signed URLs before printing MUST hand us a
  // window opened synchronously inside the click handler (see openEmployeePdf /
  // openPatientPdf). Without that, the popup blocker eats the window because
  // window.open() runs after an await and is no longer a user-gesture.
  var printWindow = preOpened || window.open("", "_blank", "width=1024,height=820");
  if (!printWindow) return;
  var logoHtml = appConfig.companyLogo
    ? "<img src='" + appConfig.companyLogo + "' alt='" + appConfig.companyName + " logo' class='logo-img'/>"
    : "<div class='logo-fallback'>H</div>";
  printWindow.document.write(
    "<html><head><title>" +
      title +
      "</title><style>" +
      "body{font-family:Segoe UI,Arial,sans-serif;padding:32px;color:#10233c}" +
      ".head{text-align:center;border-bottom:2px solid #dbe3ee;padding-bottom:16px;margin-bottom:20px}" +
      ".logo-wrap{margin:0 auto 10px;width:96px;height:96px;display:grid;place-items:center}" +
      ".logo-img{width:96px;height:96px;object-fit:contain;display:block}" +
      ".logo-fallback{width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,#0c5adb,#00a37a);color:#fff;display:grid;place-items:center;font-weight:800;font-size:30px}" +
      ".tag{color:#0c5adb;font-weight:600}" +
      "table{width:100%;border-collapse:collapse;margin-top:14px}" +
      "th,td{border:1px solid #dbe3ee;padding:10px;text-align:left;vertical-align:top}" +
      ".meta{margin:8px 0;color:#475569}" +
      ".footer{margin-top:28px;display:flex;justify-content:space-between;align-items:flex-end}" +
      ".stamp{margin-top:20px;color:#475569;font-size:12px}" +
      "</style></head><body>" +
      "<div class='head'><div class='logo-wrap'>" +
      logoHtml +
      "</div><h1>" +
      appConfig.companyName +
      "</h1><div class='tag'>" +
      appConfig.companyTagline +
      "</div><div class='meta'>" +
      appConfig.companyAddress +
      "</div><div class='meta'>Phone: " +
      appConfig.companyPhone +
      " | Email: " +
      appConfig.companyEmail +
      "</div></div>" +
      bodyHtml +
      "<div class='footer'><div><strong>Authorised Signature</strong><div style='margin-top:42px;border-top:1px solid #94a3b8;width:220px'></div></div><div><strong>Hominal Healthcare Seal</strong><div style='margin-top:42px;border-top:1px solid #94a3b8;width:180px'></div></div></div>" +
      "</body></html>"
  );
  printWindow.document.close();
  printWindow.focus();
  // Wait for every embedded image (logo + payment proofs) to finish loading
  // before opening the print dialog — otherwise the proof never makes it
  // into the saved PDF. Falls back to a hard 5s ceiling so a broken image
  // can't block the dialog forever.
  function waitForImagesAndPrint() {
    try {
      var imgs = Array.prototype.slice.call(printWindow.document.images || []);
      var pending = imgs.filter(function (i) {
        return !i.complete;
      });
      if (!pending.length) {
        setTimeout(function () {
          printWindow.print();
        }, 100);
        return;
      }
      var remaining = pending.length;
      var done = false;
      var finalize = function () {
        if (done) return;
        done = true;
        setTimeout(function () {
          printWindow.print();
        }, 150);
      };
      pending.forEach(function (img) {
        var onAny = function () {
          remaining -= 1;
          if (remaining <= 0) finalize();
        };
        img.addEventListener("load", onAny, { once: true });
        img.addEventListener("error", onAny, { once: true });
      });
      setTimeout(finalize, 5000);
    } catch (_err) {
      setTimeout(function () {
        printWindow.print();
      }, 500);
    }
  }
  setTimeout(waitForImagesAndPrint, 250);
}

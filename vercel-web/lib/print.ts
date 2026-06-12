import { appConfig } from "./config";

/** User-facing message when `window.open` is blocked by the browser. */
export const PRINT_POPUP_BLOCKED_MESSAGE =
  "Pop-up blocked — allow pop-ups for this site, then try again.";

const PRINT_WINDOW_FEATURES = "width=1024,height=820";
const PREPARING_BODY =
  "<title>Preparing…</title><body style='font-family:Segoe UI,Arial,sans-serif;padding:32px;color:#475569'>Loading…</body>";

/**
 * Open a blank print tab synchronously (must run in the same turn as the click
 * handler, before any `await`). Pass the returned window to `openPrintWindow`.
 */
export function preOpenPrintWindow(): Window | null {
  const win = window.open("about:blank", "_blank", PRINT_WINDOW_FEATURES);
  if (win?.document) {
    try {
      win.document.write(PREPARING_BODY);
    } catch {
      /* opaque about:blank in some browsers */
    }
  }
  return win;
}

/** Call when `openPrintWindow` returns false or `preOpenPrintWindow` returned null. */
export function reportPrintBlocked(onBlocked: (message: string) => void): void {
  onBlocked(PRINT_POPUP_BLOCKED_MESSAGE);
}

export function writePrintWindowMessage(
  title: string,
  bodyHtml: string,
  preOpened?: Window | null
): boolean {
  const opened = preOpened ?? window.open("about:blank", "_blank", PRINT_WINDOW_FEATURES);
  if (!opened) return false;
  opened.document.write(
    "<html><head><title>" +
      title +
      "</title><style>body{font-family:Segoe UI,Arial,sans-serif;padding:32px;color:#475569}h1{color:#10233c}</style></head><body>" +
      bodyHtml +
      "</body></html>"
  );
  opened.document.close();
  opened.focus();
  return true;
}

/**
 * Render branded print HTML and trigger the browser print dialog.
 * Returns false when the pop-up was blocked (no window to write into).
 */
export function openPrintWindow(
  title: string,
  bodyHtml: string,
  preOpened?: Window | null
): boolean {
  const opened = preOpened ?? window.open("about:blank", "_blank", PRINT_WINDOW_FEATURES);
  if (!opened) return false;
  const printWindow: Window = opened;
  const logoHtml = appConfig.companyLogo
    ? "<img src='" +
      appConfig.companyLogo +
      "' alt='" +
      appConfig.companyName +
      " logo' class='logo-img'/>"
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
  function waitForImagesAndPrint() {
    try {
      const imgs = Array.prototype.slice.call(printWindow.document.images || []);
      const pending = imgs.filter(function (i: HTMLImageElement) {
        return !i.complete;
      });
      if (!pending.length) {
        setTimeout(function () {
          printWindow.print();
        }, 100);
        return;
      }
      let remaining = pending.length;
      let done = false;
      const finalize = function () {
        if (done) return;
        done = true;
        setTimeout(function () {
          printWindow.print();
        }, 150);
      };
      pending.forEach(function (img: HTMLImageElement) {
        const onAny = function () {
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
  return true;
}

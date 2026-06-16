/* eslint-disable */
/**
 * Legacy SPA helpers — Duty Calendar SSOT for manual billing/payout grids.
 *
 * Rows materialized by the duty calendar use remarks `duty:…`. They must not
 * be sent through `hominal_replace_*` slice writers (DB + API both guard).
 */
(function (root) {
  "use strict";

  function isDutyDiaryRemarks(remarks) {
    return String(remarks || "").indexOf("duty:") === 0;
  }

  function manualLedgerRows(rows) {
    var manual = [];
    var skippedDuty = 0;
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (isDutyDiaryRemarks(row && row.remarks)) skippedDuty += 1;
      else manual.push(row);
    }
    return { rows: manual, skippedDuty: skippedDuty };
  }

  function maybeToastDutySliceSkipped(skipped, label) {
    if (skipped > 0 && typeof root.toast === "function") {
      root.toast(
        "Duty Calendar rows are read-only here (" +
          skipped +
          " " +
          label +
          " skipped). Edit them in Duty Calendar.",
        "info"
      );
    }
  }

  function isDutyCalendarLedgerEntry(entry) {
    return isDutyDiaryRemarks(entry && entry.remarks);
  }

  /**
   * Navigate to the duty calendar editor for a materialized ledger row.
   * Prefers the legacy openDutyDiary flow; falls back to /duties when hosted
   * under the Next.js app (/legacy).
   */
  function openDutyCalendarFromLedgerRow(ctx) {
    ctx = ctx || {};
    var billingId =
      ctx.billingId != null && String(ctx.billingId).trim() !== ""
        ? String(ctx.billingId).trim()
        : typeof root.currentBillIdForSvc !== "undefined"
          ? String(root.currentBillIdForSvc || "").trim()
          : "";
    var serviceName =
      ctx.serviceName != null && String(ctx.serviceName).trim() !== ""
        ? String(ctx.serviceName).trim()
        : typeof root.currentSvcName !== "undefined"
          ? String(root.currentSvcName || "").trim()
          : "";
    var patientId =
      ctx.patientId != null && String(ctx.patientId).trim() !== ""
        ? String(ctx.patientId).trim()
        : typeof root.currentBillingPatId !== "undefined"
          ? String(root.currentBillingPatId || "").trim()
          : "";

    if (typeof root.openDutyDiary === "function") {
      if (
        root.openDutyDiary({
          billingId: billingId,
          serviceName: serviceName,
          patientId: patientId
        })
      ) {
        return;
      }
    }

    if (
      typeof root.location !== "undefined" &&
      root.location &&
      String(root.location.pathname || "").indexOf("/legacy") === 0
    ) {
      var q = [];
      if (patientId) q.push("patient_id=" + encodeURIComponent(patientId));
      if (billingId) q.push("billing_id=" + encodeURIComponent(billingId));
      root.open("/duties" + (q.length ? "?" + q.join("&") : ""), "_blank");
      return;
    }

    if (typeof root.toast === "function") {
      root.toast(root.DUTY_CALENDAR_ROW_HINT, "info");
    }
  }

  root.DUTY_CALENDAR_ROW_HINT =
    "This row is from Duty Calendar. Use the Duty button to open it for editing.";
  root.isDutyCalendarLedgerEntry = isDutyCalendarLedgerEntry;
  root.isDutyDiaryRemarks = isDutyDiaryRemarks;
  root.manualLedgerRows = manualLedgerRows;
  root.maybeToastDutySliceSkipped = maybeToastDutySliceSkipped;
  root.openDutyCalendarFromLedgerRow = openDutyCalendarFromLedgerRow;
})(typeof window !== "undefined" ? window : globalThis);

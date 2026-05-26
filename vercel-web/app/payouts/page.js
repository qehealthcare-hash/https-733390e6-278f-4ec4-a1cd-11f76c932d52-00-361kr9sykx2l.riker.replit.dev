"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { paymentMethodOptions } from "@/lib/crm-options";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";
import { uploadDocument, getDocumentSignedUrl } from "@/lib/uploads";
import { hasPermission } from "@/lib/permissions";

var payoutStatusOptions = [
  { value: "OPEN", label: "Open" },
  { value: "LOCKED", label: "Locked" },
  { value: "PAID", label: "Paid" }
];

function currentPeriod() {
  var d = new Date();
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function emptyEnsureForm() {
  return {
    employee_id: "",
    period_month: currentPeriod(),
    advance: 0,
    deduction: 0,
    bonus: 0,
    remarks: ""
  };
}

function emptyAdjustForm() {
  return { advance: 0, deduction: 0, bonus: 0, remarks: "" };
}

function emptyPayForm() {
  return {
    paid_on: new Date().toISOString().slice(0, 10),
    method: "UPI",
    amount: "",
    remarks: "",
    proof: null
  };
}

function emptyAdvanceForm() {
  return {
    paid_on: new Date().toISOString().slice(0, 10),
    method: "UPI",
    amount: "",
    remarks: "",
    proof: null
  };
}

function describeProof(proof) {
  if (!proof) return "No proof attached";
  if (proof.file_name) return proof.file_name;
  return proof.path || "Attached";
}

export default function PayoutsPage() {
  var auth = useAuth();
  var userRole = auth.profile?.role || "";
  var canWrite = hasPermission(userRole, "payouts.write");
  var canDisburse =
    hasPermission(userRole, "payouts.write") ||
    String(userRole).toLowerCase() === "admin" ||
    String(userRole).toLowerCase() === "accountant";
  var searchParams = useSearchParams();
  var [employees, setEmployees] = useState([]);
  var [payouts, setPayouts] = useState([]);
  var [loading, setLoading] = useState(true);
  var [periodFilter, setPeriodFilter] = useState(
    searchParams?.get("period") || currentPeriod()
  );
  var [statusFilter, setStatusFilter] = useState("");
  var [employeeFilter, setEmployeeFilter] = useState(
    searchParams?.get("employee_id") || ""
  );
  var [selectedId, setSelectedId] = useState("");
  var [detail, setDetail] = useState(null);
  var [detailLoading, setDetailLoading] = useState(false);
  var [ensureForm, setEnsureForm] = useState(function () {
    var base = emptyEnsureForm();
    var ep = searchParams?.get("employee_id");
    var pm = searchParams?.get("period");
    if (ep) base.employee_id = ep;
    if (pm) base.period_month = pm;
    return base;
  });
  var [adjustForm, setAdjustForm] = useState(emptyAdjustForm());
  var [payForm, setPayForm] = useState(emptyPayForm());
  var [advanceForm, setAdvanceForm] = useState(emptyAdvanceForm());
  var [advanceOpen, setAdvanceOpen] = useState(false);
  var [rateRepairRate, setRateRepairRate] = useState("");
  var [pending, setPending] = useState(null);
  var [unpaidEmployees, setUnpaidEmployees] = useState({
    period: "",
    rows: [],
    total_pending: 0,
    loading: false
  });
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  async function reloadList() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var qs = new URLSearchParams();
      qs.set("limit", "200");
      if (periodFilter) qs.set("period", periodFilter);
      if (statusFilter) qs.set("status", statusFilter);
      if (employeeFilter) qs.set("employee_id", employeeFilter);
      var data = await request("/payouts?" + qs.toString(), null, auth.session);
      setPayouts(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load payouts");
      setPayouts([]);
    } finally {
      setLoading(false);
    }
  }

  async function reloadUnpaidEmployees() {
    if (!auth.session?.access_token || !periodFilter) {
      setUnpaidEmployees({ period: "", rows: [], total_pending: 0, loading: false });
      return;
    }
    setUnpaidEmployees(function (prev) {
      return { ...prev, loading: true };
    });
    try {
      var qs = new URLSearchParams();
      qs.set("period", periodFilter);
      var data = await request(
        "/payouts/pending-employees?" + qs.toString(),
        null,
        auth.session
      );
      setUnpaidEmployees({
        period: data?.period || periodFilter,
        rows: Array.isArray(data?.rows) ? data.rows : [],
        total_pending: Number(data?.total_pending || 0),
        loading: false
      });
    } catch (err) {
      setUnpaidEmployees({
        period: periodFilter,
        rows: [],
        total_pending: 0,
        loading: false
      });
    }
  }

  async function reloadPending() {
    if (!auth.session?.access_token || !employeeFilter || !periodFilter) {
      setPending(null);
      return;
    }
    try {
      var qs = new URLSearchParams();
      qs.set("employee_id", employeeFilter);
      qs.set("period", periodFilter);
      var data = await request(
        "/payouts/pending?" + qs.toString(),
        null,
        auth.session
      );
      setPending(data || null);
    } catch (err) {
      // Pending panel is informational — never block the page on its failure.
      setPending(null);
    }
  }

  async function openPayout(id) {
    if (!id) {
      setDetail(null);
      setSelectedId("");
      return;
    }
    setDetailLoading(true);
    setError("");
    try {
      var data = await request("/payouts/" + id, null, auth.session);
      setDetail(data);
      setSelectedId(id);
      var row = data?.payout || {};
      setAdjustForm({
        advance: Number(row.advance || 0),
        deduction: Number(row.deduction || 0),
        bonus: Number(row.bonus || 0),
        remarks: row.remarks || ""
      });
      setPayForm(emptyPayForm());
      setAdvanceForm(emptyAdvanceForm());
      setAdvanceOpen(false);
    } catch (err) {
      setError(err.message || "Could not load payout detail");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reloadList();
      reloadPending();
      reloadUnpaidEmployees();
      request("/lookups/employees", null, auth.session)
        .then(function (rows) {
          setEmployees(Array.isArray(rows) ? rows : []);
        })
        .catch(function () {
          setEmployees([]);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.session, periodFilter, statusFilter, employeeFilter]
  );

  // Deep-link from duty calendar: if the URL carries ?employee_id=&period=
  // and a matching payout row already exists, auto-open it once the list
  // arrives so the user lands directly on the right record.
  useEffect(
    function () {
      var ep = searchParams?.get("employee_id");
      var pm = searchParams?.get("period");
      if (!ep || !pm) return;
      if (selectedId) return;
      var match = payouts.find(function (p) {
        return p.employee_id === ep && p.period_month === pm;
      });
      if (match) openPayout(match.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payouts, searchParams]
  );

  var totals = useMemo(
    function () {
      var net = 0;
      var paid = 0;
      var open = 0;
      payouts.forEach(function (p) {
        net += Number(p.net_amount || 0);
        if (String(p.status) === "PAID") paid += Number(p.net_amount || 0);
        if (String(p.status) === "OPEN") open += Number(p.net_amount || 0);
      });
      return { net: net, paid: paid, open: open };
    },
    [payouts]
  );

  function employeeDisplayName(id) {
    if (!id) return "";
    var emp = employees.find(function (e) {
      return e.id === id;
    });
    if (emp) return emp.full_name || emp.name || id;
    return id;
  }

  async function handleEnsure(event) {
    event.preventDefault();
    if (!ensureForm.employee_id) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      var data = await requestWithOfflineFallback(
        "/payouts",
        {
          method: "POST",
          body: {
            employee_id: ensureForm.employee_id,
            period_month: ensureForm.period_month,
            advance: Number(ensureForm.advance || 0),
            deduction: Number(ensureForm.deduction || 0),
            bonus: Number(ensureForm.bonus || 0),
            remarks: ensureForm.remarks || ""
          }
        },
        auth.session
      );
      setMessage(
        "Payout ensured for " + employeeDisplayName(ensureForm.employee_id)
      );
      setEnsureForm(emptyEnsureForm());
      await reloadList();
      await reloadUnpaidEmployees();
      if (data?.id) await openPayout(data.id);
    } catch (err) {
      setError(err.message || "Could not ensure payout");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(event) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/adjust",
        {
          method: "POST",
          body: {
            payout_id: selectedId,
            advance: Number(adjustForm.advance || 0),
            deduction: Number(adjustForm.deduction || 0),
            bonus: Number(adjustForm.bonus || 0),
            remarks: adjustForm.remarks || ""
          }
        },
        auth.session
      );
      setMessage("Payout adjusted");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not adjust payout");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRate(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!payout) return;
    var rate = Number(rateRepairRate);
    if (!rate || rate <= 0) {
      setError("Enter a payout per day greater than 0");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        "/payouts/set-rate",
        {
          method: "POST",
          body: {
            employee_id: payout.employee_id,
            period: payout.period_month,
            payout_per_day: rate
          }
        },
        auth.session
      );
      setMessage(
        "Updated payout rate to ₹" +
          rate +
          "/day and refreshed " +
          employeeNameForDetail
      );
      setRateRepairRate("");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not update duty rates");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecompute() {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/recompute",
        { method: "POST", body: {} },
        auth.session
      );
      setMessage("Payout recomputed from duty + attendance");
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not recompute");
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    if (!selectedId) return;
    var reason = window.prompt("Reason for locking this payout (optional)") || "";
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/lock",
        { method: "POST", body: { reason: reason } },
        auth.session
      );
      setMessage("Payout locked");
      await openPayout(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not lock");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!selectedId) return;
    var reason = window.prompt("Reason for reopening locked payout (required)");
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/reopen",
        { method: "POST", body: { reason: reason } },
        auth.session
      );
      setMessage("Payout reopened");
      await openPayout(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not reopen");
    } finally {
      setBusy(false);
    }
  }

  async function handleProofUpload(target, files) {
    if (!files || !files[0]) return;
    setBusy(true);
    setError("");
    try {
      var uploaded = await uploadDocument({
        bucket: "payout-proofs",
        file: files[0],
        session: auth.session,
        supabase: auth.supabase
      });
      if (target === "pay") {
        setPayForm(function (f) {
          return { ...f, proof: uploaded };
        });
      } else {
        setAdvanceForm(function (f) {
          return { ...f, proof: uploaded };
        });
      }
      setMessage("Proof attached: " + uploaded.file_name);
    } catch (err) {
      setError(err.message || "Could not upload proof");
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(event) {
    event.preventDefault();
    if (!selectedId) return;
    if (!payForm.proof) {
      setError("Attach a payout proof before marking paid");
      return;
    }
    setBusy(true);
    setError("");
    try {
      var body = {
        payout_id: selectedId,
        paid_on: payForm.paid_on,
        method: payForm.method,
        remarks: payForm.remarks || "",
        proof_bucket: payForm.proof.bucket,
        proof_path: payForm.proof.path,
        photo: payForm.proof.file_name || ""
      };
      if (payForm.amount && Number(payForm.amount) > 0) {
        body.amount = Number(payForm.amount);
      }
      await requestWithOfflineFallback(
        "/payouts/pay",
        { method: "POST", body: body },
        auth.session
      );
      setMessage("Payout marked PAID");
      setPayForm(emptyPayForm());
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not mark paid");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdvance(event) {
    event.preventDefault();
    if (!selectedId) return;
    if (!advanceForm.amount || Number(advanceForm.amount) <= 0) {
      setError("Advance amount must be greater than zero");
      return;
    }
    if (!advanceForm.proof) {
      setError("Attach a payout proof before recording advance");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/" + selectedId + "/pay-advance",
        {
          method: "POST",
          body: {
            payout_id: selectedId,
            amount: Number(advanceForm.amount),
            paid_on: advanceForm.paid_on,
            method: advanceForm.method,
            remarks: advanceForm.remarks || "",
            proof_bucket: advanceForm.proof.bucket,
            proof_path: advanceForm.proof.path,
            photo: advanceForm.proof.file_name || ""
          }
        },
        auth.session
      );
      setMessage("Advance recorded");
      setAdvanceForm(emptyAdvanceForm());
      setAdvanceOpen(false);
      await openPayout(selectedId);
      await reloadList();
      await reloadPending();
      await reloadUnpaidEmployees();
    } catch (err) {
      setError(err.message || "Could not record advance");
    } finally {
      setBusy(false);
    }
  }

  async function viewProof(tx) {
    if (!tx?.proof_bucket || !tx?.proof_path) return;
    try {
      var signed = await getDocumentSignedUrl(
        { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
        auth.session
      );
      if (signed?.signedUrl) {
        window.open(signed.signedUrl, "_blank", "noopener");
      } else {
        setError("Proof is not accessible");
      }
    } catch (err) {
      setError(err.message || "Could not open proof");
    }
  }

  function patientBreakdownHtml() {
    var rows = Array.isArray(detail?.breakdown) ? detail.breakdown : [];
    if (!rows.length) return "";
    var totalAmount = 0;
    var totalDays = 0;
    var body = rows
      .map(function (r) {
        var days = Array.isArray(r.dates) ? r.dates.length : r.duty_count || 0;
        totalAmount += Number(r.amount || 0);
        totalDays += days;
        var dateRange = "";
        if (Array.isArray(r.dates) && r.dates.length) {
          dateRange = r.dates[0] + " → " + r.dates[r.dates.length - 1];
        }
        return (
          "<tr><td>" +
          (r.patient_name || r.patient_id) +
          "</td><td>" +
          days +
          "</td><td>" +
          (r.hours || 0) +
          "</td><td>" +
          dateRange +
          "</td><td style='text-align:right'>" +
          formatCurrency(r.amount) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      "<h3>Per-patient breakdown</h3>" +
      "<table><thead><tr><th>Patient</th><th>Days worked</th><th>Hours</th><th>Range</th><th style='text-align:right'>Amount</th></tr></thead>" +
      "<tbody>" +
      body +
      "<tr><td colspan='4'><strong>Total (" +
      rows.length +
      " patient" +
      (rows.length === 1 ? "" : "s") +
      ", " +
      totalDays +
      " day" +
      (totalDays === 1 ? "" : "s") +
      ")</strong></td><td style='text-align:right'><strong>" +
      formatCurrency(totalAmount) +
      "</strong></td></tr>" +
      "</tbody></table>"
    );
  }

  function printPayout() {
    if (!detail?.payout) return;
    var row = detail.payout;
    var name = row.employee_name || employeeDisplayName(row.employee_id);
    var paidRows = Array.isArray(detail.paid_transactions)
      ? detail.paid_transactions
      : [];
    var paidTable = paidRows.length
      ? "<table><thead><tr><th>Serial</th><th>Kind</th><th>Date</th><th>Method</th><th style='text-align:right'>Amount</th></tr></thead><tbody>" +
        paidRows
          .map(function (t) {
            return (
              "<tr><td>" +
              (t.serial_no || t.id) +
              "</td><td>" +
              (t.tx_kind || "FINAL") +
              "</td><td>" +
              (t.paid_on || "") +
              "</td><td>" +
              (t.method || "") +
              "</td><td style='text-align:right'>" +
              formatCurrency(t.amount) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : "";
    var statusColor =
      String(row.status) === "PAID"
        ? "#00a37a"
        : String(row.status) === "LOCKED"
        ? "#8b5e00"
        : "#0c5adb";
    var statusBadge =
      "<span style='display:inline-block;padding:3px 10px;border-radius:999px;background:" +
      statusColor +
      ";color:#fff;font-weight:700;font-size:12px;'>" +
      row.status +
      "</span>";
    var body =
      "<h2>Payout Statement</h2>" +
      "<div class='meta'><strong>Employee:</strong> " +
      name +
      "</div>" +
      "<div class='meta'><strong>Period:</strong> " +
      row.period_month +
      "</div>" +
      "<div class='meta'><strong>Status:</strong> " +
      statusBadge +
      "</div>" +
      "<table><thead><tr><th>Field</th><th style='text-align:right'>Amount</th></tr></thead><tbody>" +
      "<tr><td>Gross</td><td style='text-align:right'>" + formatCurrency(row.gross_amount) + "</td></tr>" +
      "<tr><td>Duty count</td><td style='text-align:right'>" + (row.duty_count || 0) + "</td></tr>" +
      "<tr><td>Hours</td><td style='text-align:right'>" + (row.hours || 0) + "</td></tr>" +
      "<tr><td>Advance</td><td style='text-align:right'>" + formatCurrency(row.advance) + "</td></tr>" +
      "<tr><td>Deduction</td><td style='text-align:right'>" + formatCurrency(row.deduction) + "</td></tr>" +
      "<tr><td>Bonus</td><td style='text-align:right'>" + formatCurrency(row.bonus) + "</td></tr>" +
      "<tr><td><strong>Net</strong></td><td style='text-align:right'><strong>" + formatCurrency(row.net_amount) + "</strong></td></tr>" +
      "<tr><td>Paid so far</td><td style='text-align:right'>" + formatCurrency(detail.paid_total || 0) + "</td></tr>" +
      "<tr><td>Outstanding</td><td style='text-align:right'>" + formatCurrency(detail.outstanding || 0) + "</td></tr>" +
      "</tbody></table>" +
      patientBreakdownHtml() +
      (paidTable ? "<h3>Disbursements</h3>" + paidTable : "") +
      (row.paid_at ? "<div class='meta'><strong>Paid on:</strong> " + formatDate(row.paid_at) + "</div>" : "") +
      (row.remarks ? "<div class='meta'><strong>Remarks:</strong> " + row.remarks + "</div>" : "");
    openPrintWindow("Payout " + name + " " + row.period_month, body);
  }

  // One-receipt-per-transaction PDF. Includes serial, employee name, payout
  // ref, method, amount, remarks AND the embedded payment proof image so the
  // operator can save a single PDF that doubles as the audit record. Days
  // worked per patient are listed at the bottom so the recipient sees what
  // the payment covers.
  async function printReceipt(tx) {
    if (!tx) return;
    var row = detail?.payout || null;
    var name = row
      ? row.employee_name || employeeDisplayName(row.employee_id)
      : employeeDisplayName(tx.employee_id || "");
    var period = row?.period_month || tx.period_month || "";
    var kindLabel = String(tx.tx_kind || "FINAL") === "ADVANCE" ? "Advance Receipt" : "Payout Receipt";

    // Resolve a signed URL for the proof so we can embed it in the PDF. The
    // signed download endpoint returns a URL valid for ~15 minutes — enough
    // time for the user to view + save as PDF from the print dialog.
    var proofHtml = "<div class='meta'><em>No payment proof attached</em></div>";
    var proofIsImage = false;
    if (tx.proof_bucket && tx.proof_path) {
      try {
        var signed = await getDocumentSignedUrl(
          { bucket: tx.proof_bucket, path: tx.proof_path, file_name: tx.photo },
          auth.session
        );
        if (signed?.signedUrl) {
          var path = String(tx.proof_path || "").toLowerCase();
          proofIsImage = /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(path);
          if (proofIsImage) {
            proofHtml =
              "<div class='proof-wrap'><img src='" +
              signed.signedUrl +
              "' alt='Payment proof' class='proof-img'/></div>";
          } else {
            // PDFs / non-images: link out so the saved PDF stays clickable.
            proofHtml =
              "<div class='meta'><strong>Proof file:</strong> " +
              (tx.photo || tx.proof_path) +
              " — <a href='" +
              signed.signedUrl +
              "'>open original</a></div>";
          }
        }
      } catch (err) {
        proofHtml =
          "<div class='meta' style='color:#b91c1c'>Could not load proof: " +
          (err.message || "") +
          "</div>";
      }
    }

    var rows = [
      ["Receipt no", tx.serial_no || tx.id || ""],
      ["Type", tx.tx_kind || "FINAL"],
      ["Employee", name],
      ["Period", period],
      ["Paid on", tx.paid_on || ""],
      ["Method", tx.method || ""],
      ["Amount", "<strong style='color:#00a37a'>" + formatCurrency(tx.amount) + "</strong>"],
      ["Payout ref", row ? row.id : "-"],
      ["Remarks", tx.remarks || "-"]
    ];
    var rowsHtml = rows
      .map(function (pair) {
        return (
          "<tr><th style='width:35%;text-align:left'>" +
          pair[0] +
          "</th><td>" +
          (pair[1] === null || pair[1] === undefined ? "" : pair[1]) +
          "</td></tr>"
        );
      })
      .join("");

    var breakdownHtml = patientBreakdownHtml();
    var body =
      "<style>" +
      ".proof-wrap{margin-top:18px;padding:10px;border:1px solid #dbe3ee;border-radius:8px;background:#f8fafc;text-align:center}" +
      ".proof-img{max-width:520px;max-height:520px;display:block;margin:0 auto;border:1px solid #94a3b8;border-radius:4px}" +
      ".paid-badge{display:inline-block;padding:6px 18px;border-radius:999px;background:#00a37a;color:#fff;font-weight:800;letter-spacing:1px;margin-bottom:10px}" +
      "</style>" +
      "<div style='text-align:center'><div class='paid-badge'>" +
      kindLabel.toUpperCase() +
      " — " +
      formatCurrency(tx.amount) +
      "</div></div>" +
      "<h2 style='text-align:center;margin-top:0'>" + kindLabel + "</h2>" +
      "<table><tbody>" + rowsHtml + "</tbody></table>" +
      "<h3>Payment proof</h3>" +
      proofHtml +
      breakdownHtml +
      "<div class='stamp'>I, <strong>" +
      name +
      "</strong>, confirm receiving " +
      formatCurrency(tx.amount) +
      " from Hominal Healthcare Pvt Ltd on " +
      (tx.paid_on || formatDate(new Date().toISOString())) +
      " via " +
      (tx.method || "") +
      " for the period " +
      period +
      ".</div>";

    openPrintWindow(
      kindLabel + " " + name + " " + (tx.serial_no || tx.id || ""),
      body
    );
  }

  function startEnsureForEmployee(empId, period) {
    if (!canWrite) return;
    setEnsureForm(function (prev) {
      return {
        ...prev,
        employee_id: empId || prev.employee_id,
        period_month: period || prev.period_month || currentPeriod()
      };
    });
    setMessage("Pre-filled ensure form for " + employeeDisplayName(empId));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  var payout = detail?.payout || null;
  var status = String(payout?.status || "OPEN");
  var isLocked = status === "LOCKED" || status === "PAID";
  var isPaid = status === "PAID";
  var paidTransactions = Array.isArray(detail?.paid_transactions)
    ? detail.paid_transactions
    : [];
  var outstanding = Number(detail?.outstanding || 0);
  var paidTotal = Number(detail?.paid_total || 0);
  var employeeNameForDetail = payout
    ? payout.employee_name || employeeDisplayName(payout.employee_id)
    : "";
  var diagnostics = detail?.diagnostics || null;

  return (
    <AuthGuard permission="payouts.read">
      <AppShell title="Payouts">
        <div className="page-split">
          <div className="page-grid">
            {canWrite ? (
            <ModuleShell title="Ensure / recompute" description="Recompute gross from duty + attendance and apply advance / deduction / bonus.">
              <form className="stack" onSubmit={handleEnsure}>
                <div className="grid-2">
                  <div className="field">
                    <label>Employee</label>
                    <select
                      value={ensureForm.employee_id}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, employee_id: event.target.value });
                      }}
                      required
                    >
                      <option value="">Select employee</option>
                      {employees.map(function (e) {
                        return (
                          <option key={e.id} value={e.id}>
                            {e.full_name || e.name || e.id}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Period (YYYY-MM)</label>
                    <input
                      value={ensureForm.period_month}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, period_month: event.target.value });
                      }}
                      placeholder={currentPeriod()}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Advance</label>
                    <input
                      type="number"
                      min="0"
                      value={ensureForm.advance}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, advance: event.target.value });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Deduction</label>
                    <input
                      type="number"
                      min="0"
                      value={ensureForm.deduction}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, deduction: event.target.value });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Bonus</label>
                    <input
                      type="number"
                      min="0"
                      value={ensureForm.bonus}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, bonus: event.target.value });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Remarks</label>
                    <input
                      value={ensureForm.remarks}
                      onChange={function (event) {
                        setEnsureForm({ ...ensureForm, remarks: event.target.value });
                      }}
                    />
                  </div>
                </div>
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy || !ensureForm.employee_id}>
                    {busy ? "Saving…" : "Ensure payout"}
                  </button>
                </div>
              </form>
            </ModuleShell>
            ) : (
              <ModuleShell title="Ensure / recompute" description="Read-only access — contact Admin or Accountant to create payouts.">
                <div className="helper-box">You can view payouts and pending totals but cannot ensure or pay.</div>
              </ModuleShell>
            )}

            {pending ? (
              <ModuleShell
                title={"Pending from duty calendar — " + pending.employee_name}
                description="Live total of partner pending payout for the selected period, sourced from hh_payout_charges minus disbursements."
              >
                <div className="grid-2">
                  <div>
                    <strong>Period:</strong> {pending.period}
                  </div>
                  <div>
                    <strong>Duties:</strong> {pending.duty_count}
                  </div>
                  <div>
                    <strong>Charged:</strong> {formatCurrency(pending.charged)}
                  </div>
                  <div>
                    <strong>Paid:</strong> {formatCurrency(pending.paid)}
                  </div>
                  <div>
                    <strong>Pending:</strong>{" "}
                    <span className={pending.pending > 0 ? "status open" : "status paid"}>
                      {formatCurrency(pending.pending)}
                    </span>
                  </div>
                  <div>
                    <strong>Payout row:</strong>{" "}
                    {pending.payout
                      ? pending.payout.status + " · " + pending.payout.id
                      : "Not yet ensured"}
                  </div>
                </div>
                {Array.isArray(pending.paid_transactions) && pending.paid_transactions.length ? (
                  <div className="stack" style={{ marginTop: 12 }}>
                    <strong>Disbursements this period ({pending.paid_transactions.length})</strong>
                    <div className="record-list">
                      {pending.paid_transactions.map(function (tx) {
                        return (
                          <div key={tx.id} className="record-card">
                            <div className="record-meta">
                              <span>{tx.serial_no || tx.id}</span>
                              <span>{tx.tx_kind || "FINAL"}</span>
                              <span>{tx.paid_on || ""}</span>
                              <span>{formatCurrency(tx.amount)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </ModuleShell>
            ) : null}

            <ModuleShell
              title={"Unpaid employees — " + (unpaidEmployees.period || periodFilter || "")}
              description="Every employee with outstanding payout balance for this period (charged in duty calendar minus disbursements). Click to ensure or open the payout."
            >
              <div className="helper-box">
                {unpaidEmployees.loading
                  ? "Loading…"
                  : unpaidEmployees.rows.length === 0
                  ? "All employees fully paid for this period."
                  : unpaidEmployees.rows.length +
                    " employee" +
                    (unpaidEmployees.rows.length === 1 ? "" : "s") +
                    " · Total pending " +
                    formatCurrency(unpaidEmployees.total_pending)}
              </div>
              {unpaidEmployees.rows.length ? (
                <div className="record-list">
                  {unpaidEmployees.rows.map(function (row) {
                    var statusLabel = row.payout_status || "UNPAID";
                    return (
                      <div key={row.employee_id} className="record-card">
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>{row.employee_name || row.employee_id}</h3>
                            <div className="record-meta">
                              <span>{row.duty_count || 0} duties</span>
                              <span>Charged {formatCurrency(row.charged)}</span>
                              <span>Paid {formatCurrency(row.paid)}</span>
                              <span>
                                <strong>Pending {formatCurrency(row.pending)}</strong>
                              </span>
                            </div>
                          </div>
                          <div className="button-row">
                            <span className={"status " + String(statusLabel).toLowerCase()}>
                              {statusLabel}
                            </span>
                            {row.payout_id ? (
                              <button
                                type="button"
                                className="button secondary"
                                onClick={function () {
                                  setEmployeeFilter(row.employee_id);
                                  openPayout(row.payout_id);
                                }}
                              >
                                Open
                              </button>
                            ) : canWrite ? (
                              <button
                                type="button"
                                className="button primary"
                                onClick={function () {
                                  startEnsureForEmployee(
                                    row.employee_id,
                                    unpaidEmployees.period || periodFilter
                                  );
                                }}
                              >
                                Ensure
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </ModuleShell>

            <ModuleShell title="Payout ledger" description="hh_payouts month view. Filter by period, status, or employee.">
              <div className="toolbar">
                <div className="field">
                  <label>Period</label>
                  <input
                    value={periodFilter}
                    onChange={function (event) {
                      setPeriodFilter(event.target.value);
                    }}
                    placeholder="YYYY-MM"
                  />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    value={statusFilter}
                    onChange={function (event) {
                      setStatusFilter(event.target.value);
                    }}
                  >
                    <option value="">All</option>
                    {payoutStatusOptions.map(function (o) {
                      return (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Employee</label>
                  <select
                    value={employeeFilter}
                    onChange={function (event) {
                      setEmployeeFilter(event.target.value);
                    }}
                  >
                    <option value="">All</option>
                    {employees.map(function (e) {
                      return (
                        <option key={e.id} value={e.id}>
                          {e.full_name || e.name || e.id}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="button secondary" type="button" onClick={reloadList}>
                    Refresh
                  </button>
                </div>
              </div>
              <div className="helper-box">
                Net {formatCurrency(totals.net)} &nbsp;·&nbsp; Paid {formatCurrency(totals.paid)} &nbsp;·&nbsp;
                Open {formatCurrency(totals.open)}
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              {!payouts.length ? (
                <EmptyState
                  title={loading ? "Loading…" : "No payouts"}
                  description="Ensure a payout above to start the period for this employee."
                />
              ) : (
                <div className="record-list">
                  {payouts.map(function (row) {
                    var name = row.employee_name || employeeDisplayName(row.employee_id);
                    var isSelected = selectedId === row.id;
                    return (
                      <div
                        key={row.id}
                        className={"record-card" + (isSelected ? " selected" : "")}
                        role="button"
                        tabIndex={0}
                        onClick={function () {
                          openPayout(row.id);
                        }}
                      >
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>{name}</h3>
                            <div className="record-meta">
                              <span>{row.period_month}</span>
                              <span>Net {formatCurrency(row.net_amount)}</span>
                              <span>
                                {row.duty_count || 0} duties · {row.hours || 0}h
                              </span>
                            </div>
                          </div>
                          <span className={"status " + String(row.status || "open").toLowerCase()}>
                            {row.status || "OPEN"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModuleShell>
          </div>

          <div className="page-grid">
            <ModuleShell
              title={payout ? employeeNameForDetail + " · " + payout.period_month : "Payout detail"}
              description="Adjust, lock, recompute, pay advance, or mark paid."
            >
              {!payout ? (
                <EmptyState
                  title={detailLoading ? "Loading…" : "Select a payout"}
                  description="Pick any row in the ledger to inspect, adjust, lock or pay."
                />
              ) : (
                <div className="stack">
                  <div className="helper-box">
                    <div>
                      <strong>Employee:</strong> {employeeNameForDetail} &nbsp;·&nbsp;
                      <strong>Period:</strong> {payout.period_month} &nbsp;·&nbsp;
                      <strong>Status:</strong> {status}
                    </div>
                    <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                      Payout ref {payout.id}
                    </div>
                    <div className="grid-2" style={{ marginTop: 8 }}>
                      <div>
                        <strong>Gross:</strong> {formatCurrency(payout.gross_amount)}
                      </div>
                      <div>
                        <strong>Net:</strong> {formatCurrency(payout.net_amount)}
                      </div>
                      <div>
                        <strong>Duty count:</strong> {payout.duty_count || 0}
                      </div>
                      <div>
                        <strong>Hours:</strong> {payout.hours || 0}
                      </div>
                      <div>
                        <strong>Advance (adj):</strong> {formatCurrency(payout.advance)}
                      </div>
                      <div>
                        <strong>Deduction:</strong> {formatCurrency(payout.deduction)}
                      </div>
                      <div>
                        <strong>Bonus:</strong> {formatCurrency(payout.bonus)}
                      </div>
                      <div>
                        <strong>Paid so far:</strong> {formatCurrency(paidTotal)}
                      </div>
                      <div>
                        <strong>Outstanding:</strong>{" "}
                        <span className={outstanding > 0 ? "status open" : "status paid"}>
                          {formatCurrency(outstanding)}
                        </span>
                      </div>
                      <div>
                        <strong>Paid on:</strong> {payout.paid_at ? formatDate(payout.paid_at) : "-"}
                      </div>
                    </div>
                  </div>

                  {isPaid && outstanding <= 0 ? (
                    <div
                      className="helper-box"
                      style={{
                        background: "#dcfce7",
                        borderColor: "#16a34a",
                        textAlign: "center",
                        fontWeight: 700,
                        color: "#166534",
                        fontSize: 16
                      }}
                    >
                      ✓ PAID — {formatCurrency(paidTotal)} disbursed in{" "}
                      {paidTransactions.length} transaction
                      {paidTransactions.length === 1 ? "" : "s"}
                    </div>
                  ) : paidTotal > 0 && outstanding > 0 ? (
                    <div
                      className="helper-box"
                      style={{
                        background: "#fef9c3",
                        borderColor: "#ca8a04",
                        color: "#854d0e",
                        fontWeight: 600
                      }}
                    >
                      Partially paid — {formatCurrency(paidTotal)} of{" "}
                      {formatCurrency(payout.net_amount || 0)} ·{" "}
                      <strong>{formatCurrency(outstanding)} still pending</strong>
                    </div>
                  ) : null}

                  {Array.isArray(detail?.breakdown) && detail.breakdown.length ? (
                    <div className="helper-box" style={{ background: "#f0fdf4", borderColor: "#16a34a" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong>
                          Patients worked this period ({detail.breakdown.length})
                        </strong>
                        <span className="mini-muted">From duty calendar</span>
                      </div>
                      <div className="record-list" style={{ marginTop: 8 }}>
                        {detail.breakdown.map(function (b) {
                          var days = Array.isArray(b.dates) ? b.dates.length : b.duty_count || 0;
                          var range = "";
                          if (Array.isArray(b.dates) && b.dates.length) {
                            range = b.dates[0] + " → " + b.dates[b.dates.length - 1];
                          }
                          return (
                            <div key={b.patient_id} className="record-card" style={{ padding: 8 }}>
                              <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <h3 style={{ margin: 0 }}>{b.patient_name || b.patient_id}</h3>
                                  <div className="record-meta">
                                    <span>{days} day{days === 1 ? "" : "s"}</span>
                                    <span>{b.hours || 0}h</span>
                                    {range ? <span>{range}</span> : null}
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontWeight: 700, color: "#16a34a" }}>
                                    {formatCurrency(b.amount)}
                                  </div>
                                  <div className="mini-muted">{b.patient_id}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {diagnostics ? (
                    <div
                      className="helper-box"
                      style={{
                        background: diagnostics.warning ? "#fff4f4" : "#f1f7ff",
                        borderColor: diagnostics.warning ? "#dc2626" : "#0c5adb"
                      }}
                    >
                      <div>
                        <strong>Where this data comes from</strong>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13 }}>
                        <div>
                          Gross ← <code>hh_payout_charges</code>: {diagnostics.charge_row_count} row
                          {diagnostics.charge_row_count === 1 ? "" : "s"} · sum {formatCurrency(diagnostics.charge_sum)}
                          {diagnostics.charge_zero_rate_rows > 0
                            ? " · " + diagnostics.charge_zero_rate_rows + " row(s) at ₹0"
                            : ""}
                          {diagnostics.charge_distinct_svc_keys > 0
                            ? " · " + diagnostics.charge_distinct_svc_keys + " billing service(s)"
                            : ""}
                        </div>
                        <div>
                          Duty count / Hours ← <code>hh_attendance</code>: {diagnostics.attendance_payable_count} payable row
                          {diagnostics.attendance_payable_count === 1 ? "" : "s"} · {diagnostics.attendance_payable_hours}h
                          {diagnostics.attendance_row_count > diagnostics.attendance_payable_count
                            ? " (" + (diagnostics.attendance_row_count - diagnostics.attendance_payable_count) + " non-payable)"
                            : ""}
                        </div>
                        <div>
                          Source duties ← <code>hh_duties</code>: {diagnostics.duty_row_count} row
                          {diagnostics.duty_row_count === 1 ? "" : "s"} overlapping {payout.period_month}
                          {Object.keys(diagnostics.duty_statuses || {}).length
                            ? " (" +
                              Object.entries(diagnostics.duty_statuses)
                                .map(function (pair) {
                                  return pair[0] + ": " + pair[1];
                                })
                                .join(", ") +
                              ")"
                            : ""}
                        </div>
                        {diagnostics.charge_last_updated_at ? (
                          <div style={{ color: "#64748b" }}>
                            Charges last materialized {formatDate(diagnostics.charge_last_updated_at)}
                          </div>
                        ) : null}
                      </div>
                      {diagnostics.warning ? (
                        <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 600 }}>
                          {diagnostics.warning}
                        </div>
                      ) : null}
                      {canWrite && Array.isArray(diagnostics.duties_needing_rate) && diagnostics.duties_needing_rate.length > 0 ? (
                        <div className="stack" style={{ marginTop: 12 }}>
                          <strong>
                            Duties without a payout rate ({diagnostics.duties_needing_rate.length})
                          </strong>
                          <div className="record-list" style={{ maxHeight: 180, overflowY: "auto" }}>
                            {diagnostics.duties_needing_rate.map(function (d) {
                              return (
                                <div key={d.duty_id} className="record-card" style={{ padding: 8 }}>
                                  <div className="record-meta">
                                    <span>{d.duty_id}</span>
                                    <span>{d.service_name || ""}</span>
                                    <span>
                                      {String(d.start_at || "").slice(0, 10)} →{" "}
                                      {String(d.end_at || "").slice(0, 10)}
                                    </span>
                                    <span className={"status " + String(d.status || "").toLowerCase()}>
                                      {d.status}
                                    </span>
                                    {d.charge_per_day ? (
                                      <span>Charge ₹{d.charge_per_day}/day</span>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <form
                            className="button-row"
                            onSubmit={handleSetRate}
                            style={{ alignItems: "flex-end" }}
                          >
                            <div className="field" style={{ minWidth: 180 }}>
                              <label>Payout per day for these duties</label>
                              <input
                                type="number"
                                min="1"
                                step="0.01"
                                placeholder="e.g. 800"
                                value={rateRepairRate}
                                onChange={function (event) {
                                  setRateRepairRate(event.target.value);
                                }}
                                disabled={busy || isPaid}
                              />
                            </div>
                            <button
                              type="submit"
                              className="button primary"
                              disabled={busy || isPaid || !rateRepairRate}
                            >
                              Set rate &amp; refresh
                            </button>
                          </form>
                          <div className="mini-muted">
                            Applies to <strong>{diagnostics.duties_needing_rate.length}</strong> duty/duties for{" "}
                            {employeeNameForDetail} in {payout.period_month}, then re-materializes the diary and
                            recomputes this payout.
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="button-row">
                    <button className="button secondary" type="button" onClick={printPayout}>
                      Print
                    </button>
                    {canWrite ? (
                      <button className="button secondary" type="button" onClick={handleRecompute} disabled={busy || isLocked}>
                        Recompute
                      </button>
                    ) : null}
                    {canWrite && status === "OPEN" ? (
                      <button className="button secondary" type="button" onClick={handleLock} disabled={busy}>
                        Lock
                      </button>
                    ) : null}
                    {canWrite && status === "LOCKED" ? (
                      <button className="button secondary" type="button" onClick={handleReopen} disabled={busy}>
                        Reopen
                      </button>
                    ) : null}
                    {canDisburse && status === "OPEN" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={function () {
                          setAdvanceOpen(function (v) {
                            return !v;
                          });
                        }}
                      >
                        {advanceOpen ? "Hide advance" : "Pay advance"}
                      </button>
                    ) : null}
                  </div>

                  {canWrite && (!isLocked || status === "LOCKED") ? (
                    <form className="stack" onSubmit={handleAdjust}>
                      <strong>Adjust</strong>
                      <div className="grid-2">
                        <div className="field">
                          <label>Advance</label>
                          <input
                            type="number"
                            min="0"
                            value={adjustForm.advance}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, advance: event.target.value });
                            }}
                            disabled={isLocked}
                          />
                        </div>
                        <div className="field">
                          <label>Deduction</label>
                          <input
                            type="number"
                            min="0"
                            value={adjustForm.deduction}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, deduction: event.target.value });
                            }}
                            disabled={isLocked}
                          />
                        </div>
                        <div className="field">
                          <label>Bonus</label>
                          <input
                            type="number"
                            min="0"
                            value={adjustForm.bonus}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, bonus: event.target.value });
                            }}
                            disabled={isLocked}
                          />
                        </div>
                        <div className="field">
                          <label>Remarks</label>
                          <input
                            value={adjustForm.remarks}
                            onChange={function (event) {
                              setAdjustForm({ ...adjustForm, remarks: event.target.value });
                            }}
                            disabled={isLocked}
                          />
                        </div>
                      </div>
                      <div className="button-row">
                        <button className="button primary" type="submit" disabled={busy || isLocked}>
                          Apply adjustment
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {canDisburse && advanceOpen && status === "OPEN" ? (
                    <form className="stack" onSubmit={handleAdvance}>
                      <strong>Pay advance</strong>
                      <div className="helper-box" style={{ background: "#fff7e6", borderColor: "#f59e0b" }}>
                        Payment proof (bank slip / UPI screenshot / signed receipt) is <strong>required</strong> before submission. The disbursement is rejected by the server if proof is missing.
                      </div>
                      <div className="grid-2">
                        <div className="field">
                          <label>Amount</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={advanceForm.amount}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, amount: event.target.value });
                            }}
                            required
                          />
                        </div>
                        <div className="field">
                          <label>Paid on</label>
                          <input
                            type="date"
                            value={advanceForm.paid_on}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, paid_on: event.target.value });
                            }}
                            required
                          />
                        </div>
                        <div className="field">
                          <label>Method</label>
                          <select
                            value={advanceForm.method}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, method: event.target.value });
                            }}
                          >
                            {paymentMethodOptions.map(function (o) {
                              return (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="field">
                          <label>Remarks</label>
                          <input
                            value={advanceForm.remarks}
                            onChange={function (event) {
                              setAdvanceForm({ ...advanceForm, remarks: event.target.value });
                            }}
                          />
                        </div>
                        <div className="field" style={{ gridColumn: "1 / -1" }}>
                          <label>Proof (image or PDF) — required</label>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={function (event) {
                              handleProofUpload("advance", event.target.files);
                            }}
                          />
                          <small>{describeProof(advanceForm.proof)}</small>
                        </div>
                      </div>
                      <div className="button-row">
                        <button
                          className="button primary"
                          type="submit"
                          disabled={busy || !advanceForm.proof || !advanceForm.amount}
                        >
                          Record advance
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {canDisburse && status === "LOCKED" ? (
                    <form className="stack" onSubmit={handlePay}>
                      <strong>Mark as paid</strong>
                      <div className="helper-box" style={{ background: "#fff7e6", borderColor: "#f59e0b" }}>
                        Payment proof (bank slip / UPI screenshot / signed receipt) is <strong>required</strong> before submission. The disbursement is rejected by the server if proof is missing.
                      </div>
                      <div className="grid-2">
                        <div className="field">
                          <label>Paid on</label>
                          <input
                            type="date"
                            value={payForm.paid_on}
                            onChange={function (event) {
                              setPayForm({ ...payForm, paid_on: event.target.value });
                            }}
                            required
                          />
                        </div>
                        <div className="field">
                          <label>Method</label>
                          <select
                            value={payForm.method}
                            onChange={function (event) {
                              setPayForm({ ...payForm, method: event.target.value });
                            }}
                          >
                            {paymentMethodOptions.map(function (o) {
                              return (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="field">
                          <label>Amount (blank = settle outstanding {formatCurrency(outstanding)})</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={payForm.amount}
                            placeholder={String(outstanding.toFixed(2))}
                            onChange={function (event) {
                              setPayForm({ ...payForm, amount: event.target.value });
                            }}
                          />
                        </div>
                        <div className="field">
                          <label>Remarks</label>
                          <input
                            value={payForm.remarks}
                            onChange={function (event) {
                              setPayForm({ ...payForm, remarks: event.target.value });
                            }}
                          />
                        </div>
                        <div className="field" style={{ gridColumn: "1 / -1" }}>
                          <label>Proof (image or PDF) — required</label>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={function (event) {
                              handleProofUpload("pay", event.target.files);
                            }}
                          />
                          <small>{describeProof(payForm.proof)}</small>
                        </div>
                      </div>
                      <div className="button-row">
                        <button className="button success" type="submit" disabled={busy || !payForm.proof}>
                          Mark paid
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <div className="stack">
                    <strong>Disbursements ({paidTransactions.length})</strong>
                    {paidTransactions.length === 0 ? (
                      <div className="helper-box">
                        No disbursements recorded yet. Record an advance or mark paid to add one.
                      </div>
                    ) : (
                      <div className="record-list">
                        {paidTransactions.map(function (tx) {
                          return (
                            <div key={tx.id} className="record-card">
                              <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                  <h3>{tx.serial_no || tx.id}</h3>
                                  <div className="record-meta">
                                    <span>{tx.tx_kind || "FINAL"}</span>
                                    <span>{tx.paid_on || ""}</span>
                                    <span>{tx.method || ""}</span>
                                    <span>{formatCurrency(tx.amount)}</span>
                                  </div>
                                  {tx.remarks ? <div className="record-meta"><span>{tx.remarks}</span></div> : null}
                                </div>
                                <div className="button-row">
                                  <button
                                    type="button"
                                    className="button secondary"
                                    onClick={function () {
                                      printReceipt(tx);
                                    }}
                                  >
                                    Receipt PDF
                                  </button>
                                  {tx.proof_bucket && tx.proof_path ? (
                                    <button
                                      type="button"
                                      className="button secondary"
                                      onClick={function () {
                                        viewProof(tx);
                                      }}
                                    >
                                      View proof
                                    </button>
                                  ) : (
                                    <span className="status open">No proof</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </ModuleShell>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

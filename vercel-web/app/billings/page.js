"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import {
  billingStatusOptions,
  closeReasonOptions,
  paymentMethodOptions,
  receiptTypeOptions
} from "@/lib/crm-options";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";

function monthOptions(count) {
  var now = new Date();
  var out = [];
  for (var i = 0; i < count; i += 1) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    out.push({
      value: y + "-" + m,
      label: d.toLocaleString("en-IN", { month: "long", year: "numeric" })
    });
  }
  return out;
}

function amountWords(amount) {
  var n = Math.round(Number(amount || 0));
  if (!isFinite(n) || n <= 0) return "Zero";
  var a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  var b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function chunk(num) {
    if (num === 0) return "";
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 ? " " + a[num % 10] : "");
    return a[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + chunk(num % 100) : "");
  }
  var crore = Math.floor(n / 10000000);
  n %= 10000000;
  var lakh = Math.floor(n / 100000);
  n %= 100000;
  var thousand = Math.floor(n / 1000);
  n %= 1000;
  var rest = n;
  var parts = [];
  if (crore) parts.push(chunk(crore) + " Crore");
  if (lakh) parts.push(chunk(lakh) + " Lakh");
  if (thousand) parts.push(chunk(thousand) + " Thousand");
  if (rest) parts.push(chunk(rest));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function emptyReceiptForm(billingId) {
  return {
    billing_id: billingId || "",
    invoice_id: "",
    type: "Advance",
    method: "Cash",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    ref: "",
    remarks: ""
  };
}

function emptySecDepForm() {
  return { sec_dep: 0 };
}

function paidStatusBadge(status) {
  var label = String(status || "UNPAID").toUpperCase();
  var color = "#94a3b8";
  if (label === "PAID") color = "#16a34a";
  else if (label === "PARTIAL") color = "#f59e0b";
  else if (label === "UNPAID") color = "#dc2626";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: color,
        color: "#fff",
        marginLeft: 8
      }}
    >
      {label}
    </span>
  );
}

function totalsFromBundle(bundle) {
  if (!bundle?.totals) {
    return { billed: 0, receipts: 0, outstanding: 0, sec_dep: 0 };
  }
  return {
    billed: Number(bundle.totals.billed || 0),
    receipts: Number(bundle.totals.receipts || 0),
    outstanding: Number(bundle.totals.outstanding || 0),
    sec_dep: Number(bundle.totals.sec_dep || 0)
  };
}

export default function BillingsPage() {
  var auth = useAuth();
  var [billings, setBillings] = useState([]);
  // P1-28: track the API limit + the server's total so we can surface a
  // "Showing first N of M — refine filters" banner when the list is capped.
  // Previously a clinic with > 100 active bills only ever saw the first 100
  // and there was zero indication of truncation.
  var LIST_LIMIT = 100;
  var [billingsTotal, setBillingsTotal] = useState(0);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [search, setSearch] = useState("");
  var [patients, setPatients] = useState([]);
  var [employeeNameById, setEmployeeNameById] = useState({});
  var [selectedId, setSelectedId] = useState("");
  var [bundle, setBundle] = useState(null);
  var [bundleLoading, setBundleLoading] = useState(false);
  var [receiptForm, setReceiptForm] = useState(emptyReceiptForm());
  var [secDepForm, setSecDepForm] = useState(emptySecDepForm());
  var [createPatientId, setCreatePatientId] = useState("");
  var [createSecDep, setCreateSecDep] = useState(0);
  var [busy, setBusy] = useState(false);

  async function reloadList() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var qs = new URLSearchParams();
      qs.set("limit", String(LIST_LIMIT));
      if (statusFilter) qs.set("status", statusFilter);
      if (search.trim()) qs.set("q", search.trim());
      var data = await request("/billings?" + qs.toString(), null, auth.session);
      var rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
      setBillings(rows);
      setBillingsTotal(Number(data?.total ?? rows.length) || rows.length);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load bills");
      setBillings([]);
      setBillingsTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function openBilling(id) {
    if (!id) {
      setBundle(null);
      setSelectedId("");
      return;
    }
    setBundleLoading(true);
    setError("");
    try {
      var data = await request("/billings/" + id, null, auth.session);
      setBundle(data);
      setSelectedId(id);
      setReceiptForm(emptyReceiptForm(id));
      setSecDepForm({ sec_dep: Number(data?.billing?.sec_dep ?? 0) });
    } catch (err) {
      setError(err.message || "Could not load bill detail");
      setBundle(null);
    } finally {
      setBundleLoading(false);
    }
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reloadList();
      request("/lookups/patients", null, auth.session)
        .then(function (rows) {
          setPatients(Array.isArray(rows) ? rows : []);
        })
        .catch(function () {
          setPatients([]);
        });
      request("/lookups/employees", null, auth.session)
        .then(function (rows) {
          var arr = Array.isArray(rows) ? rows : rows?.rows || rows?.data || [];
          var map = {};
          arr.forEach(function (e) {
            map[e.id] = e.name || e.full_name || e.id;
          });
          setEmployeeNameById(map);
        })
        .catch(function () { setEmployeeNameById({}); });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.session, statusFilter]
  );

  useEffect(
    function () {
      if (!auth.session?.access_token || !auth.supabase) return undefined;
      var channel = auth.supabase.channel("crm-billing-ledger");
      ["hh_billings", "hh_invoices", "hh_receipts", "hh_svc_entries"].forEach(function (table) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: table },
          function () {
            reloadList();
            if (selectedId) openBilling(selectedId);
          }
        );
      });
      channel.subscribe();
      return function () {
        auth.supabase.removeChannel(channel);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.session, auth.supabase, selectedId]
  );

  var filtered = useMemo(
    function () {
      if (!search.trim()) return billings;
      var needle = search.trim().toLowerCase();
      return billings.filter(function (row) {
        return (
          String(row.id || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.invoice_no || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.patient_id || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.patient_name || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.patient_phone || "").toLowerCase().indexOf(needle) >= 0
        );
      });
    },
    [billings, search]
  );

  async function handleCreate(event) {
    event.preventDefault();
    if (!createPatientId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      var data = await requestWithOfflineFallback(
        "/billings",
        {
          method: "POST",
          body: {
            patient_id: createPatientId,
            sec_dep: Number(createSecDep || 0)
          }
        },
        auth.session
      );
      setMessage("Bill created for patient " + createPatientId);
      setCreatePatientId("");
      setCreateSecDep(0);
      await reloadList();
      if (data?.id) await openBilling(data.id);
    } catch (err) {
      setError(err.message || "Could not create bill");
    } finally {
      setBusy(false);
    }
  }

  async function handleSecDepSave(event) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/billings/" + selectedId,
        {
          method: "PATCH",
          body: { sec_dep: Number(secDepForm.sec_dep || 0) }
        },
        auth.session
      );
      setMessage("Security deposit updated");
      await openBilling(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not update security deposit");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateInvoice(kind, period) {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      var body = { kind: kind };
      if (kind === "MONTHLY") body.period = period;
      var data = await requestWithOfflineFallback(
        "/billings/" + selectedId + "/invoices",
        { method: "POST", body: body },
        auth.session
      );
      var note = data && data.duplicate
        ? "Invoice for " + period + " already exists — opened existing"
        : "Invoice generated";
      setMessage(note);
      await openBilling(selectedId);
      await reloadList();
      return data && data.invoice ? data.invoice : null;
    } catch (err) {
      setError(err.message || "Could not generate invoice");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteInvoice(invoiceId, invoiceLabel) {
    if (!selectedId || !invoiceId) return;
    if (
      !window.confirm(
        "Delete invoice " +
          (invoiceLabel || invoiceId) +
          " permanently? It will be removed from the ledger and any receipts already recorded against it become on-account credit on the bill."
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      var data = await requestWithOfflineFallback(
        "/billings/" + selectedId + "/invoices/" + invoiceId,
        { method: "DELETE" },
        auth.session
      );
      var detached = data && data.receipts_detached ? data.receipts_detached : 0;
      setMessage(
        "Invoice deleted" +
          (detached ? " · " + detached + " receipt(s) returned to on-account" : "")
      );
      await openBilling(selectedId);
    } catch (err) {
      setError(err.message || "Could not delete invoice");
    } finally {
      setBusy(false);
    }
  }

  async function handleReceiptSubmit(event) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/billings/" + selectedId + "/receipts",
        {
          method: "POST",
          body: {
            billing_id: selectedId,
            invoice_id: receiptForm.invoice_id || null,
            type: receiptForm.type,
            method: receiptForm.method,
            amount: Number(receiptForm.amount || 0),
            date: receiptForm.date,
            ref: receiptForm.ref || "",
            remarks: receiptForm.remarks || ""
          }
        },
        auth.session
      );
      setReceiptForm(emptyReceiptForm(selectedId));
      setMessage("Receipt recorded");
      await openBilling(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not record receipt");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(nextStatus) {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/billings/" + selectedId + "/status",
        { method: "POST", body: { status: nextStatus } },
        auth.session
      );
      setMessage("Status set to " + nextStatus);
      await openBilling(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not change status");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (!selectedId) return;
    var reason = window.prompt(
      "Reason for closing this bill (" + closeReasonOptions.join(" / ") + ")",
      closeReasonOptions[0]
    );
    if (!reason) return;
    var force = false;
    var outstanding = totalsFromBundle(bundle).outstanding;
    if (outstanding > 0) {
      force = window.confirm(
        "Outstanding balance is " + formatCurrency(outstanding) + ". Close anyway? (force)"
      );
      if (!force) return;
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/billings/" + selectedId + "/close",
        { method: "POST", body: { reason: reason, force: force } },
        auth.session
      );
      setMessage("Bill closed");
      await openBilling(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not close bill");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!selectedId) return;
    var reason = window.prompt("Reason for re-opening this bill (required)");
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/billings/" + selectedId + "/reopen",
        { method: "POST", body: { reason: reason } },
        auth.session
      );
      setMessage("Bill reopened");
      await openBilling(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not reopen bill");
    } finally {
      setBusy(false);
    }
  }

  function patientBlock() {
    var patient = (bundle && bundle.patient) || {};
    var patientId = (bundle && bundle.billing && bundle.billing.patient_id) || "-";
    var patientName = patient.name || "-";
    var patientPhone = patient.phone || "";
    var patientAddress = [patient.address, patient.area, patient.city, patient.pincode]
      .filter(Boolean)
      .join(", ");
    return (
      "<div class='meta'><strong>Patient:</strong> " +
      patientName +
      " <span style='color:#94a3b8'>(" +
      patientId +
      ")</span></div>" +
      (patientPhone
        ? "<div class='meta'><strong>Phone:</strong> " + patientPhone + "</div>"
        : "") +
      (patientAddress
        ? "<div class='meta'><strong>Address:</strong> " + patientAddress + "</div>"
        : "")
    );
  }

  function printReceipt(receipt) {
    if (!bundle?.billing || !receipt) return;
    var num = receipt.receipt_no || receipt.id || "-";
    var invoiceLabel = "-";
    if (receipt.invoice_id && bundle.invoices) {
      var match = bundle.invoices.find(function (row) {
        return String(row.invoice && row.invoice.id) === String(receipt.invoice_id);
      });
      if (match && match.invoice) invoiceLabel = match.invoice.invoice_no || match.invoice.id;
    }
    var body =
      "<h2 style='margin:0 0 6px'>Receipt</h2>" +
      "<div class='meta'><strong>Receipt no:</strong> " + num + "</div>" +
      "<div class='meta'><strong>Date:</strong> " + formatDate(receipt.date || receipt.created_at) + "</div>" +
      "<div class='meta'><strong>Against invoice:</strong> " + invoiceLabel + "</div>" +
      patientBlock() +
      "<table style='margin-top:14px'><tbody>" +
      "<tr><th style='width:35%'>Type</th><td>" + (receipt.type || "Advance") + "</td></tr>" +
      "<tr><th>Method</th><td>" + (receipt.method || "Cash") + "</td></tr>" +
      "<tr><th>Reference</th><td>" + (receipt.ref || "-") + "</td></tr>" +
      "<tr><th>Remarks</th><td>" + (receipt.remarks || "-") + "</td></tr>" +
      "<tr><th>Amount</th><td><strong>" + formatCurrency(receipt.amount) + "</strong></td></tr>" +
      "<tr><th>Amount (in words)</th><td>Rupees " + amountWords(receipt.amount) + " only</td></tr>" +
      "</tbody></table>" +
      "<div class='stamp'>This is a system-generated receipt. Subject to realisation of cheque / UPI / NEFT.</div>";
    openPrintWindow("Receipt " + num, body);
  }

  function printDepositReceipt() {
    if (!bundle?.billing) return;
    var amount = Number(bundle.billing.sec_dep || 0);
    var body =
      "<h2 style='margin:0 0 6px'>Security Deposit Receipt</h2>" +
      "<div class='meta'><strong>Bill account:</strong> " + bundle.billing.id + "</div>" +
      "<div class='meta'><strong>Date:</strong> " + formatDate(bundle.billing.created_at || bundle.billing.created) + "</div>" +
      patientBlock() +
      "<table style='margin-top:14px'><tbody>" +
      "<tr><th style='width:35%'>Type</th><td>Security Deposit</td></tr>" +
      "<tr><th>Amount</th><td><strong>" + formatCurrency(amount) + "</strong></td></tr>" +
      "<tr><th>Amount (in words)</th><td>Rupees " + amountWords(amount) + " only</td></tr>" +
      "</tbody></table>" +
      "<div class='stamp'>Refundable on bill close / patient discharge after settlement of dues.</div>";
    openPrintWindow("Security Deposit " + bundle.billing.id, body);
  }

  function summarizeInvoiceLines(lines) {
    // Group by (service_name + rate) so we render "Care Taker × 25 days @ ₹750".
    var map = new Map();
    var partnerSet = new Set();
    var datesByGroup = new Map();
    (lines || []).forEach(function (l) {
      var rate = Number(l.amt || 0);
      var name = String(l.service_name || "Service");
      var count = Number(l.count || 1);
      var total = Number(l.total != null ? l.total : rate * count);
      var key = name + "||" + rate;
      var existing = map.get(key);
      if (existing) {
        existing.days += count;
        existing.total += total;
      } else {
        map.set(key, { service_name: name, rate: rate, days: count, total: total });
      }
      if (l.partner) partnerSet.add(String(l.partner));
      var dlist = datesByGroup.get(key) || [];
      if (l.date) dlist.push(String(l.date).slice(0, 10));
      datesByGroup.set(key, dlist);
    });
    var groups = Array.from(map.values()).sort(function (a, b) {
      return a.service_name.localeCompare(b.service_name) || a.rate - b.rate;
    });
    groups.forEach(function (g) {
      var d = datesByGroup.get(g.service_name + "||" + g.rate) || [];
      d.sort();
      if (d.length) {
        g.from = d[0];
        g.to = d[d.length - 1];
      }
    });
    var partners = Array.from(partnerSet).map(function (pid) {
      var name = employeeNameById[pid];
      return name && name !== pid ? name : pid;
    });
    return { groups: groups, partners: partners };
  }

  async function printInvoiceById(invoiceId) {
    if (!selectedId || !invoiceId) return;
    setBusy(true);
    try {
      var data = await request(
        "/billings/" + selectedId + "/invoices/" + invoiceId,
        null,
        auth.session
      );
      var inv = data.invoice || {};
      var lines = data.lines || [];
      var summary = summarizeInvoiceLines(lines);
      var totalDays = summary.groups.reduce(function (s, g) { return s + g.days; }, 0);
      var rows = summary.groups
        .map(function (g) {
          var rangeLabel = g.from
            ? (g.from === g.to ? formatDate(g.from) : formatDate(g.from) + " — " + formatDate(g.to))
            : "-";
          return (
            "<tr><td>" + g.service_name + "</td>" +
            "<td>" + rangeLabel + "</td>" +
            "<td style='text-align:right'>" + g.days + "</td>" +
            "<td style='text-align:right'>" + formatCurrency(g.rate) + "</td>" +
            "<td style='text-align:right'><strong>" + formatCurrency(g.total) + "</strong></td></tr>"
          );
        })
        .join("");
      var amount = Number(inv.amount || 0);
      var received = Number(data.received || 0);
      var outstanding = Number(data.outstanding || 0);
      var status = data.status || inv.status || "UNPAID";
      var period = inv.period
        ? " for " + inv.period
        : (inv.from_date ? " (" + formatDate(inv.from_date) + " — " + formatDate(inv.to_date) + ")" : "");
      var partnerLabel = summary.partners.length
        ? summary.partners.length === 1
          ? "Care partner: <strong>" + summary.partners[0] + "</strong>"
          : "Care partners (" + summary.partners.length + "): <strong>" + summary.partners.join(", ") + "</strong>"
        : "Care partner: <strong>—</strong>";
      var body =
        "<h2 style='margin:0 0 6px'>Invoice" + period + "</h2>" +
        "<div class='meta'><strong>Invoice no:</strong> " + (inv.invoice_no || inv.id) + "</div>" +
        "<div class='meta'><strong>Date:</strong> " + formatDate(inv.created_at) + "</div>" +
        "<div class='meta'><strong>Status:</strong> " + status + "</div>" +
        patientBlock() +
        "<div class='meta'>" + partnerLabel + "</div>" +
        "<h3>Charges</h3>" +
        "<table><thead><tr><th>Service</th><th>Period</th><th style='text-align:right'>Days</th><th style='text-align:right'>Per-day charge</th><th style='text-align:right'>Total</th></tr></thead><tbody>" +
        (rows || "<tr><td colspan='5'>No items</td></tr>") +
        "<tr><td colspan='2' style='text-align:right'><strong>Total duties</strong></td><td style='text-align:right'><strong>" + totalDays + "</strong></td><td style='text-align:right'><strong>Subtotal</strong></td><td style='text-align:right'><strong>" + formatCurrency(amount) + "</strong></td></tr>" +
        "<tr><td colspan='4' style='text-align:right'>Received</td><td style='text-align:right'>" + formatCurrency(received) + "</td></tr>" +
        "<tr><td colspan='4' style='text-align:right'><strong>Balance due</strong></td><td style='text-align:right'><strong>" + formatCurrency(outstanding) + "</strong></td></tr>" +
        "</tbody></table>" +
        "<div class='meta' style='margin-top:14px'><strong>Amount (in words):</strong> Rupees " + amountWords(amount) + " only</div>";
      openPrintWindow("Invoice " + (inv.invoice_no || inv.id), body);
    } catch (err) {
      setError(err.message || "Could not load invoice");
    } finally {
      setBusy(false);
    }
  }

  function printBill() {
    if (!bundle?.billing) return;
    var totals = totalsFromBundle(bundle);
    var summary = summarizeInvoiceLines(bundle.services || []);
    var totalDays = summary.groups.reduce(function (s, g) { return s + g.days; }, 0);
    var serviceRows = summary.groups
      .map(function (g) {
        var rangeLabel = g.from
          ? (g.from === g.to ? formatDate(g.from) : formatDate(g.from) + " — " + formatDate(g.to))
          : "-";
        return (
          "<tr><td>" + g.service_name + "</td>" +
          "<td>" + rangeLabel + "</td>" +
          "<td style='text-align:right'>" + g.days + "</td>" +
          "<td style='text-align:right'>" + formatCurrency(g.rate) + "</td>" +
          "<td style='text-align:right'><strong>" + formatCurrency(g.total) + "</strong></td></tr>"
        );
      })
      .join("");
    var partnerLine = summary.partners.length
      ? "<div class='meta'>" +
        (summary.partners.length === 1
          ? "<strong>Care partner:</strong> " + summary.partners[0]
          : "<strong>Care partners (" + summary.partners.length + "):</strong> " + summary.partners.join(", ")) +
        "</div>"
      : "";
    var receiptRows = (bundle.receipts || [])
      .map(function (r) {
        return (
          "<tr><td>" +
          formatDate(r.date) +
          "</td><td>" +
          (r.type || "") +
          "</td><td>" +
          (r.method || "") +
          "</td><td>" +
          formatCurrency(r.amount) +
          "</td><td>" +
          (r.ref || "") +
          "</td></tr>"
        );
      })
      .join("");
    var body =
      "<h2 style='margin:0 0 6px'>Statement of Account</h2>" +
      "<div class='meta'><strong>Bill account:</strong> " + bundle.billing.id + "</div>" +
      patientBlock() +
      "<div class='meta'><strong>Status:</strong> " +
      (bundle.billing.status || "Active") + " · " + (bundle.billing.paid_status || "UNPAID") +
      "</div>" +
      partnerLine +
      "<h3>Charges</h3>" +
      "<table><thead><tr><th>Service</th><th>Period</th><th style='text-align:right'>Days</th><th style='text-align:right'>Per-day charge</th><th style='text-align:right'>Total</th></tr></thead><tbody>" +
      (serviceRows || "<tr><td colspan='5'>No entries</td></tr>") +
      "<tr><td colspan='2' style='text-align:right'><strong>Total duties</strong></td><td style='text-align:right'><strong>" + totalDays + "</strong></td><td colspan='2' style='text-align:right'><strong>" + formatCurrency(totals.billed) + "</strong></td></tr>" +
      "</tbody></table>" +
      "<h3>Receipts</h3>" +
      "<table><thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Amount</th><th>Ref</th></tr></thead><tbody>" +
      (receiptRows || "<tr><td colspan='5'>No receipts</td></tr>") +
      "</tbody></table>" +
      "<div class='meta'><strong>Billed:</strong> " +
      formatCurrency(totals.billed) +
      "</div>" +
      "<div class='meta'><strong>Receipts:</strong> " +
      formatCurrency(totals.receipts) +
      "</div>" +
      "<div class='meta'><strong>Security Deposit:</strong> " +
      formatCurrency(totals.sec_dep) +
      "</div>" +
      "<div class='meta'><strong>Outstanding:</strong> " +
      formatCurrency(totals.outstanding) +
      "</div>";
    openPrintWindow("Statement " + bundle.billing.id, body);
  }

  async function loadPatientInvoices(patientId) {
    var data = await request("/billings?patient_id=" + encodeURIComponent(patientId), null, auth.session);
    return {
      billings: data.billings || [],
      receipts: data.receipts || [],
      totalsByBilling: data.totalsByBilling || {},
      invoices: data.invoices || []
    };
  }

  async function handleRegenerateInvoice(invoiceId, invoiceLabel) {
    if (!selectedId || !invoiceId) return;
    if (
      !window.confirm(
        "Regenerate invoice " +
          (invoiceLabel || invoiceId) +
          "? This rebuilds line items from current service entries (only when no receipts are applied)."
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/billings/" + selectedId + "/invoices/" + invoiceId + "/regenerate",
        { method: "POST" },
        auth.session
      );
      setMessage("Invoice regenerated from latest services");
      await openBilling(selectedId);
    } catch (err) {
      setError(err.message || "Could not regenerate invoice");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateManualInvoice(lines) {
    if (!selectedId || !lines.length) return;
    setBusy(true);
    setError("");
    try {
      var data = await requestWithOfflineFallback(
        "/billings/" + selectedId + "/invoices",
        {
          method: "POST",
          body: {
            kind: "MANUAL",
            manual_lines: lines
          }
        },
        auth.session
      );
      setMessage("Manual invoice created");
      await openBilling(selectedId);
      await reloadList();
      if (data && data.invoice && data.invoice.id) printInvoiceById(data.invoice.id);
    } catch (err) {
      setError(err.message || "Could not create manual invoice");
    } finally {
      setBusy(false);
    }
  }

  function openPatientAccount() {
    var pid = bundle?.billing?.patient_id;
    if (!pid) return;
    setBusy(true);
    loadPatientInvoices(pid)
      .then(function (data) {
        var receipts = data.receipts || [];
        var invoices = data.invoices || [];
        var totalsMap = data.totalsByBilling || {};
        var bills = data.billings || [];
        var name =
          (bundle.patient && bundle.patient.name) ||
          pid;
        var invoiceRows = invoices
          .map(function (row) {
            var inv = row.invoice;
            return (
              "<tr><td>" + (inv.invoice_no || inv.id) + "</td><td>" +
              formatDate(inv.created_at) + "</td><td>" +
              (inv.kind || "MONTHLY") + "</td><td>" +
              (inv.period || (inv.from_date ? formatDate(inv.from_date) + " — " + formatDate(inv.to_date) : "-")) + "</td><td>" +
              (row.status || inv.status || "UNPAID") + "</td><td>" +
              formatCurrency(row.amount) + "</td><td>" +
              formatCurrency(row.received) + "</td><td>" +
              formatCurrency(row.outstanding) + "</td></tr>"
            );
          })
          .join("");
        var receiptRows = receipts
          .map(function (r) {
            return (
              "<tr><td>" + (r.receipt_no || r.id) + "</td><td>" +
              formatDate(r.date) + "</td><td>" +
              (r.invoice_id || "-") + "</td><td>" +
              (r.type || "") + "</td><td>" +
              (r.method || "") + "</td><td>" +
              formatCurrency(r.amount) + "</td><td>" +
              (r.ref || "-") + "</td></tr>"
            );
          })
          .join("");
        var totalInvoiced = invoices.reduce(function (s, row) { return s + Number(row.amount || 0); }, 0);
        var totalReceived = invoices.reduce(function (s, row) { return s + Number(row.received || 0); }, 0);
        var totalOutstanding = invoices.reduce(function (s, row) { return s + Number(row.outstanding || 0); }, 0);
        var totalSecDep = bills.reduce(function (s, b) { return s + Number(b.sec_dep || 0); }, 0);
        var body =
          "<h2 style='margin:0 0 6px'>Patient Account Ledger</h2>" +
          "<div class='meta'><strong>Patient:</strong> " + name + " <span style='color:#94a3b8'>(" + pid + ")</span></div>" +
          "<h3>Invoices</h3>" +
          "<table><thead><tr><th>Invoice no</th><th>Date</th><th>Kind</th><th>Period</th><th>Status</th><th>Amount</th><th>Received</th><th>Outstanding</th></tr></thead><tbody>" +
          (invoiceRows || "<tr><td colspan='8'>No invoices</td></tr>") +
          "</tbody></table>" +
          "<h3>Receipts</h3>" +
          "<table><thead><tr><th>Receipt no</th><th>Date</th><th>Invoice</th><th>Type</th><th>Method</th><th>Amount</th><th>Ref</th></tr></thead><tbody>" +
          (receiptRows || "<tr><td colspan='7'>No receipts</td></tr>") +
          "</tbody></table>" +
          "<div class='meta' style='margin-top:14px'><strong>Total invoiced:</strong> " + formatCurrency(totalInvoiced) + "</div>" +
          "<div class='meta'><strong>Total received:</strong> " + formatCurrency(totalReceived) + "</div>" +
          "<div class='meta'><strong>Outstanding across invoices:</strong> " + formatCurrency(totalOutstanding) + "</div>" +
          "<div class='meta'><strong>Security deposits held:</strong> " + formatCurrency(totalSecDep) + "</div>";
        openPrintWindow("Patient account — " + name, body);
      })
      .catch(function (err) {
        setError(err.message || "Could not load patient account");
      })
      .finally(function () {
        setBusy(false);
      });
  }

  var totals = totalsFromBundle(bundle);
  var status = String(bundle?.billing?.status || "Active");
  var paidStatus = String(bundle?.billing?.paid_status || "UNPAID");
  var isClosed = status === "Closed" || status === "Cancelled";
  var monthOpts = useMemo(function () { return monthOptions(12); }, []);
  var [invoicePeriod, setInvoicePeriod] = useState(monthOpts[0]?.value || "");
  var [showManualInvoice, setShowManualInvoice] = useState(false);
  var [manualLines, setManualLines] = useState([
    {
      date: new Date().toISOString().slice(0, 10),
      service_name: "Care Taker Services",
      partner: "",
      count: 1,
      amt: 750,
      total: 750
    }
  ]);

  var selectedInvoiceOutstanding = useMemo(
    function () {
      if (!receiptForm.invoice_id || !bundle?.invoices) return null;
      var match = bundle.invoices.find(function (row) {
        return String(row.invoice && row.invoice.id) === String(receiptForm.invoice_id);
      });
      return match ? Number(match.outstanding || 0) : null;
    },
    [receiptForm.invoice_id, bundle]
  );

  var availablePeriods = useMemo(
    function () {
      if (!bundle?.services) return [];
      var set = new Set();
      bundle.services.forEach(function (s) {
        var key = String(s.date || "").slice(0, 7);
        if (key) set.add(key);
      });
      return Array.from(set).sort().reverse();
    },
    [bundle]
  );

  return (
    <AuthGuard permission="billings.read">
      <AppShell title="Billing">
        <div className="page-split">
          <div className="page-grid">
            <ModuleShell title="Open new bill" description="Create an Active bill for a patient. Security deposit can be added now or later.">
              <form className="stack" onSubmit={handleCreate}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="billings-patient-1">Patient</label>
                    <select id="billings-patient-1"
                      value={createPatientId}
                      onChange={function (event) {
                        setCreatePatientId(event.target.value);
                      }}
                      required
                    >
                      <option value="">Select patient</option>
                      {patients.map(function (p) {
                        return (
                          <option key={p.id} value={p.id}>
                            {(p.full_name || p.name || p.id) + (p.mobile ? " (" + p.mobile + ")" : "")}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="billings-security-deposit-2">Security deposit</label>
                    <input id="billings-security-deposit-2"
                      type="number"
                      min="0"
                      value={createSecDep}
                      onChange={function (event) {
                        setCreateSecDep(event.target.value);
                      }}
                    />
                  </div>
                </div>
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy || !createPatientId}>
                    {busy ? "Saving…" : "Create bill"}
                  </button>
                </div>
              </form>
            </ModuleShell>

            <ModuleShell title="Patient bills" description="Live ledger from hh_billings. Click a row for full detail.">
              <div className="toolbar">
                <div className="field">
                  <label htmlFor="billings-status-3">Status</label>
                  <select id="billings-status-3"
                    value={statusFilter}
                    onChange={function (event) {
                      setStatusFilter(event.target.value);
                    }}
                  >
                    <option value="">All statuses</option>
                    {billingStatusOptions.map(function (item) {
                      return (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="billings-search-4">Search</label>
                  <input id="billings-search-4"
                    placeholder="patient name / invoice no / phone"
                    value={search}
                    onChange={function (event) {
                      setSearch(event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <span aria-hidden="true">&nbsp;</span>
                  <button className="button secondary" type="button" onClick={reloadList}>
                    Refresh
                  </button>
                </div>
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              {billings.length >= LIST_LIMIT && billingsTotal > billings.length ? (
                <div className="info-text" role="status" style={{ background: "#fff7e6", border: "1px solid #ffd28d", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
                  Showing first {billings.length} of {billingsTotal} bills — refine filters to narrow the list.
                </div>
              ) : null}
              {!filtered.length ? (
                <EmptyState
                  title={loading ? "Loading bills…" : "No bills"}
                  description="Bills appear here as soon as they are opened from any module."
                />
              ) : (
                <div className="record-list">
                  {filtered.map(function (row) {
                    var isSelected = selectedId === row.id;
                    return (
                      <div
                        className={"record-card" + (isSelected ? " selected" : "")}
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        onClick={function () {
                          openBilling(row.id);
                        }}
                      >
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3 style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                              {row.patient_name || row.patient_id || "Unnamed patient"}
                              {paidStatusBadge(row.paid_status)}
                            </h3>
                            <div className="record-meta">
                              {row.patient_phone ? <span>{row.patient_phone}</span> : null}
                              <span>Sec dep {formatCurrency(row.sec_dep)}</span>
                              {row.totals ? (
                                <span>
                                  Outstanding {formatCurrency(row.totals.outstanding)}
                                </span>
                              ) : null}
                              <span>{formatDate(row.created_at || row.created)}</span>
                            </div>
                          </div>
                          <span className={"status " + String(row.status || "Active").toLowerCase()}>{row.status || "Active"}</span>
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
              title={bundle?.billing ? ((bundle.patient && bundle.patient.name) || "Patient account") : "Bill detail"}
              description="Services, invoices, receipts, totals — all server-computed. Each invoice generation creates a new invoice number; receipts are recorded against a specific invoice."
            >
              {!bundle ? (
                <EmptyState
                  title={bundleLoading ? "Loading…" : "Select a bill"}
                  description="Pick any bill on the left to see services, receipts, totals, and actions."
                />
              ) : (
                <div className="stack">
                  <div className="helper-box">
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                      <strong>Patient:</strong>{" "}
                      {(bundle.patient && bundle.patient.name) || bundle.billing.patient_id || "-"}
                      {bundle.patient && bundle.patient.name && bundle.billing.patient_id ? (
                        <span className="mini-muted"> · {bundle.billing.patient_id}</span>
                      ) : null}
                      <span style={{ marginLeft: 8 }}>·</span>
                      <strong>Status:</strong> {status}
                      {paidStatusBadge(paidStatus)}
                    </div>
                    <div className="mini-muted" style={{ marginTop: 4 }}>
                      Bill account <strong>{bundle.billing.id}</strong> · Created {formatDate(bundle.billing.created_at || bundle.billing.created)}
                    </div>
                    <div className="grid-2" style={{ marginTop: 8 }}>
                      <div>
                        <strong>Billed:</strong> {formatCurrency(totals.billed)}
                      </div>
                      <div>
                        <strong>Receipts:</strong> {formatCurrency(totals.receipts)}
                      </div>
                      <div>
                        <strong>Security deposit:</strong> {formatCurrency(totals.sec_dep)}
                      </div>
                      <div>
                        <strong>Outstanding:</strong> {formatCurrency(totals.outstanding)}
                      </div>
                    </div>
                  </div>

                  <div className="button-row">
                    <button className="button secondary" type="button" onClick={printBill}>
                      Print statement
                    </button>
                    {Number(bundle.billing.sec_dep || 0) > 0 ? (
                      <button className="button secondary" type="button" onClick={printDepositReceipt}>
                        Deposit receipt PDF
                      </button>
                    ) : null}
                    <button className="button secondary" type="button" onClick={openPatientAccount} disabled={busy}>
                      Patient account ledger
                    </button>
                    {status === "Active" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={function () {
                          handleStatus("Paused");
                        }}
                        disabled={busy}
                      >
                        Pause
                      </button>
                    ) : null}
                    {status === "Paused" ? (
                      <button
                        className="button secondary"
                        type="button"
                        onClick={function () {
                          handleStatus("Active");
                        }}
                        disabled={busy}
                      >
                        Resume
                      </button>
                    ) : null}
                    {!isClosed ? (
                      <button className="button danger" type="button" onClick={handleClose} disabled={busy}>
                        Close bill
                      </button>
                    ) : (
                      <button className="button secondary" type="button" onClick={handleReopen} disabled={busy}>
                        Reopen
                      </button>
                    )}
                  </div>

                  <div className="stack">
                    <strong>Generate invoice</strong>
                    <div className="grid-2">
                      <div className="field">
                        <label htmlFor="billings-billing-month-6">Billing month</label>
                        <select id="billings-billing-month-6"
                          value={invoicePeriod}
                          onChange={function (event) {
                            setInvoicePeriod(event.target.value);
                          }}
                          disabled={isClosed}
                        >
                          {(availablePeriods.length
                            ? availablePeriods.map(function (p) { return { value: p, label: p }; })
                            : monthOpts
                          ).map(function (opt) {
                            return (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="field">
                        <span aria-hidden="true">&nbsp;</span>
                        <button
                          className="button primary"
                          type="button"
                          onClick={async function () {
                            var inv = await handleGenerateInvoice("MONTHLY", invoicePeriod);
                            if (inv && inv.id) printInvoiceById(inv.id);
                          }}
                          disabled={!invoicePeriod || isClosed || busy}
                        >
                          Generate monthly invoice
                        </button>
                      </div>
                    </div>
                    <div className="mini-muted">
                      Snapshots all services dated in the chosen month into a new invoice with its own number. The new invoice opens as UNPAID — record receipts below to move it to PARTIAL/PAID.
                    </div>
                    {!isClosed ? (
                      <div className="stack" style={{ marginTop: 12 }}>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={function () { setShowManualInvoice(!showManualInvoice); }}
                        >
                          {showManualInvoice ? "Hide manual invoice" : "Manual invoice (ad-hoc)"}
                        </button>
                        {showManualInvoice ? (
                          <div className="stack">
                            {manualLines.map(function (line, idx) {
                              return (
                                <div className="grid-2" key={"ml-" + idx}>
                                  <div className="field">
                                    <label htmlFor="billings-date-8">Date</label>
                                    <input id="billings-date-8"
                                      type="date"
                                      value={line.date}
                                      onChange={function (e) {
                                        var next = manualLines.slice();
                                        next[idx] = { ...line, date: e.target.value };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-service-9">Service</label>
                                    <input id="billings-service-9"
                                      value={line.service_name}
                                      onChange={function (e) {
                                        var next = manualLines.slice();
                                        next[idx] = { ...line, service_name: e.target.value };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-partner-id-optional-10">Partner id (optional)</label>
                                    <input id="billings-partner-id-optional-10"
                                      value={line.partner}
                                      onChange={function (e) {
                                        var next = manualLines.slice();
                                        next[idx] = { ...line, partner: e.target.value };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-per-day-charge-11">Per-day charge</label>
                                    <input id="billings-per-day-charge-11"
                                      type="number"
                                      min="0"
                                      value={line.amt}
                                      onChange={function (e) {
                                        var amt = Number(e.target.value || 0);
                                        var next = manualLines.slice();
                                        next[idx] = {
                                          ...line,
                                          amt: amt,
                                          total: amt * Number(line.count || 1)
                                        };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-days-12">Days</label>
                                    <input id="billings-days-12"
                                      type="number"
                                      min="1"
                                      value={line.count}
                                      onChange={function (e) {
                                        var count = Number(e.target.value || 1);
                                        var next = manualLines.slice();
                                        next[idx] = {
                                          ...line,
                                          count: count,
                                          total: Number(line.amt || 0) * count
                                        };
                                        setManualLines(next);
                                      }}
                                    />
                                  </div>
                                  <div className="field">
                                    <label htmlFor="billings-total-13">Total</label>
                                    <input id="billings-total-13" type="number" min="0" value={line.total} readOnly />
                                  </div>
                                </div>
                              );
                            })}
                            <div className="button-row">
                              <button
                                className="button secondary"
                                type="button"
                                onClick={function () {
                                  setManualLines(
                                    manualLines.concat({
                                      date: new Date().toISOString().slice(0, 10),
                                      service_name: "Care Taker Services",
                                      partner: "",
                                      count: 1,
                                      amt: 750,
                                      total: 750
                                    })
                                  );
                                }}
                              >
                                Add line
                              </button>
                              <button
                                className="button primary"
                                type="button"
                                disabled={busy}
                                onClick={function () { handleGenerateManualInvoice(manualLines); }}
                              >
                                Create manual invoice
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="table-wrap">
                    <strong>Invoices</strong>
                    <table>
                      <thead>
                        <tr>
                          <th>Invoice no</th>
                          <th>Kind</th>
                          <th>Period</th>
                          <th>Amount</th>
                          <th>Received</th>
                          <th>Outstanding</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {!bundle.invoices || !bundle.invoices.length ? (
                          <tr>
                            <td colSpan="9" className="mini-muted">
                              No invoices yet. Generate a monthly invoice above (or a manual one for ad-hoc charges).
                            </td>
                          </tr>
                        ) : (
                          bundle.invoices.map(function (row) {
                            var inv = row.invoice;
                            var statusUpper = String(row.status || "UNPAID").toUpperCase();
                            return (
                              <tr key={inv.id}>
                                <td>{inv.invoice_no || inv.id}</td>
                                <td>{inv.kind}</td>
                                <td>{inv.period || (inv.from_date ? formatDate(inv.from_date) + " — " + formatDate(inv.to_date) : "-")}</td>
                                <td>{formatCurrency(row.amount)}</td>
                                <td>{formatCurrency(row.received)}</td>
                                <td>{formatCurrency(row.outstanding)}</td>
                                <td>{paidStatusBadge(statusUpper)}</td>
                                <td>{formatDate(inv.created_at)}</td>
                                <td>
                                  <div className="button-row" style={{ gap: 4 }}>
                                    <button
                                      className="button secondary"
                                      type="button"
                                      onClick={function () { printInvoiceById(inv.id); }}
                                    >
                                      PDF
                                    </button>
                                    {inv.kind === "MONTHLY" &&
                                    Number(row.received || 0) <= 0 &&
                                    statusUpper !== "PAID" &&
                                    !isClosed ? (
                                      <button
                                        className="button secondary"
                                        type="button"
                                        onClick={function () {
                                          handleRegenerateInvoice(
                                            inv.id,
                                            inv.invoice_no || inv.id
                                          );
                                        }}
                                      >
                                        Regenerate
                                      </button>
                                    ) : null}
                                    {statusUpper !== "PAID" && !isClosed ? (
                                      <button
                                        className="button danger"
                                        type="button"
                                        onClick={function () {
                                          handleDeleteInvoice(
                                            inv.id,
                                            inv.invoice_no || inv.id
                                          );
                                        }}
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <form className="stack" onSubmit={handleSecDepSave}>
                    <strong>Security deposit</strong>
                    <div className="grid-2">
                      <div className="field">
                        <label htmlFor="billings-amount-14">Amount</label>
                        <input id="billings-amount-14"
                          type="number"
                          min="0"
                          value={secDepForm.sec_dep}
                          onChange={function (event) {
                            setSecDepForm({ sec_dep: event.target.value });
                          }}
                          disabled={isClosed}
                        />
                      </div>
                      <div className="field">
                        <span aria-hidden="true">&nbsp;</span>
                        <button className="button primary" type="submit" disabled={busy || isClosed}>
                          Update deposit
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="table-wrap">
                    <strong>Services</strong>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Service</th>
                          <th>Partner</th>
                          <th>Count</th>
                          <th>Rate</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!bundle.services || !bundle.services.length ? (
                          <tr>
                            <td colSpan="6" className="mini-muted">
                              No service entries yet. Generate from a duty in the Duties module.
                            </td>
                          </tr>
                        ) : (
                          bundle.services.map(function (s) {
                            return (
                              <tr key={s.id || s.svc_key + "-" + s.date}>
                                <td>{formatDate(s.date)}</td>
                                <td>{s.service_name}</td>
                                <td>{s.partner || "-"}</td>
                                <td>{s.count}</td>
                                <td>{formatCurrency(s.amt)}</td>
                                <td>{formatCurrency(s.total)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <form className="stack" onSubmit={handleReceiptSubmit}>
                    <strong>Add receipt</strong>
                    {selectedInvoiceOutstanding != null ? (
                      <div className="mini-muted">
                        Invoice outstanding: <strong>{formatCurrency(selectedInvoiceOutstanding)}</strong>
                        {Number(receiptForm.amount || 0) > selectedInvoiceOutstanding + 0.005 ? (
                          <span style={{ color: "#dc2626", marginLeft: 8 }}>
                            Amount exceeds outstanding
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="grid-2">
                      <div className="field">
                        <label htmlFor="billings-apply-to-invoice-16">Apply to invoice</label>
                        <select id="billings-apply-to-invoice-16"
                          value={receiptForm.invoice_id}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, invoice_id: event.target.value });
                          }}
                          disabled={isClosed}
                        >
                          <option value="">No invoice (on-account / advance)</option>
                          {(bundle.invoices || [])
                            .filter(function (row) {
                              var st = String(row.status || "").toUpperCase();
                              return st !== "CANCELLED" && st !== "PAID";
                            })
                            .map(function (row) {
                              var inv = row.invoice;
                              return (
                                <option key={inv.id} value={inv.id}>
                                  {(inv.invoice_no || inv.id) +
                                    (inv.period ? " · " + inv.period : "") +
                                    " · outstanding " + formatCurrency(row.outstanding)}
                                </option>
                              );
                            })}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="billings-type-17">Type</label>
                        <select id="billings-type-17"
                          value={receiptForm.type}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, type: event.target.value });
                          }}
                          disabled={isClosed}
                        >
                          {receiptTypeOptions.map(function (o) {
                            return (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="billings-method-18">Method</label>
                        <select id="billings-method-18"
                          value={receiptForm.method}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, method: event.target.value });
                          }}
                          disabled={isClosed}
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
                        <label htmlFor="billings-amount-19">Amount</label>
                        <input id="billings-amount-19"
                          type="number"
                          min="0"
                          value={receiptForm.amount}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, amount: event.target.value });
                          }}
                          required
                          disabled={isClosed}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="billings-date-20">Date</label>
                        <input id="billings-date-20"
                          type="date"
                          value={receiptForm.date}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, date: event.target.value });
                          }}
                          required
                          disabled={isClosed}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="billings-reference-21">Reference</label>
                        <input id="billings-reference-21"
                          value={receiptForm.ref}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, ref: event.target.value });
                          }}
                          placeholder="UPI ref / cheque no"
                          disabled={isClosed}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="billings-remarks-22">Remarks</label>
                        <input id="billings-remarks-22"
                          value={receiptForm.remarks}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, remarks: event.target.value });
                          }}
                          disabled={isClosed}
                        />
                      </div>
                    </div>
                    <div className="button-row">
                      <button
                        className="button success"
                        type="submit"
                        disabled={
                          busy ||
                          isClosed ||
                          (selectedInvoiceOutstanding != null &&
                            Number(receiptForm.amount || 0) >
                              selectedInvoiceOutstanding + 0.005)
                        }
                      >
                        Record receipt
                      </button>
                    </div>
                  </form>

                  <div className="table-wrap">
                    <strong>Receipts ledger</strong>
                    <table>
                      <thead>
                        <tr>
                          <th>Receipt no</th>
                          <th>Date</th>
                          <th>Applied to</th>
                          <th>Type</th>
                          <th>Method</th>
                          <th>Amount</th>
                          <th>Ref</th>
                          <th>Remarks</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {!bundle.receipts || !bundle.receipts.length ? (
                          <tr>
                            <td colSpan="9" className="mini-muted">
                              No receipts recorded.
                            </td>
                          </tr>
                        ) : (
                          bundle.receipts.map(function (r) {
                            var invLabel = "-";
                            if (r.invoice_id && bundle.invoices) {
                              var match = bundle.invoices.find(function (row) {
                                return String(row.invoice && row.invoice.id) === String(r.invoice_id);
                              });
                              if (match && match.invoice) invLabel = match.invoice.invoice_no || match.invoice.id;
                            }
                            return (
                              <tr key={r.id}>
                                <td>{r.receipt_no || r.id}</td>
                                <td>{formatDate(r.date)}</td>
                                <td>{invLabel}</td>
                                <td>{r.type}</td>
                                <td>{r.method}</td>
                                <td>{formatCurrency(r.amount)}</td>
                                <td>{r.ref || "-"}</td>
                                <td>{r.remarks || "-"}</td>
                                <td>
                                  <button
                                    className="button secondary"
                                    type="button"
                                    onClick={function () { printReceipt(r); }}
                                  >
                                    PDF
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
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

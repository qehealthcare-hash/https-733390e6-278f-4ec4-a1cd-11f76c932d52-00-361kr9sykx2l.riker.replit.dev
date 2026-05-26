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
  var [pending, setPending] = useState(null);
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
    } catch (err) {
      setError(err.message || "Could not adjust payout");
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

  function printPayout() {
    if (!detail?.payout) return;
    var row = detail.payout;
    var name = row.employee_name || employeeDisplayName(row.employee_id);
    var paidRows = Array.isArray(detail.paid_transactions)
      ? detail.paid_transactions
      : [];
    var paidTable = paidRows.length
      ? "<table><thead><tr><th>Serial</th><th>Kind</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead><tbody>" +
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
              "</td><td>" +
              formatCurrency(t.amount) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : "";
    var body =
      "<h2>Payout Statement</h2>" +
      "<div class='meta'><strong>Employee:</strong> " +
      name +
      "</div>" +
      "<div class='meta'><strong>Period:</strong> " +
      row.period_month +
      "</div>" +
      "<div class='meta'><strong>Status:</strong> " +
      row.status +
      "</div>" +
      "<table><thead><tr><th>Field</th><th>Amount</th></tr></thead><tbody>" +
      "<tr><td>Gross</td><td>" + formatCurrency(row.gross_amount) + "</td></tr>" +
      "<tr><td>Duty count</td><td>" + (row.duty_count || 0) + "</td></tr>" +
      "<tr><td>Hours</td><td>" + (row.hours || 0) + "</td></tr>" +
      "<tr><td>Advance</td><td>" + formatCurrency(row.advance) + "</td></tr>" +
      "<tr><td>Deduction</td><td>" + formatCurrency(row.deduction) + "</td></tr>" +
      "<tr><td>Bonus</td><td>" + formatCurrency(row.bonus) + "</td></tr>" +
      "<tr><td><strong>Net</strong></td><td><strong>" + formatCurrency(row.net_amount) + "</strong></td></tr>" +
      "<tr><td>Paid so far</td><td>" + formatCurrency(detail.paid_total || 0) + "</td></tr>" +
      "<tr><td>Outstanding</td><td>" + formatCurrency(detail.outstanding || 0) + "</td></tr>" +
      "</tbody></table>" +
      (paidTable ? "<h3>Disbursements</h3>" + paidTable : "") +
      (row.paid_at ? "<div class='meta'><strong>Paid on:</strong> " + formatDate(row.paid_at) + "</div>" : "") +
      (row.remarks ? "<div class='meta'><strong>Remarks:</strong> " + row.remarks + "</div>" : "");
    openPrintWindow("Payout " + row.id, body);
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
                      <strong>Status:</strong> {status} &nbsp;·&nbsp;
                      <strong>Period:</strong> {payout.period_month} &nbsp;·&nbsp;
                      <strong>Employee:</strong> {employeeNameForDetail}
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

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

function emptyReceiptForm(billingId) {
  return {
    billing_id: billingId || "",
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
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [search, setSearch] = useState("");
  var [patients, setPatients] = useState([]);
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
      qs.set("limit", "100");
      if (statusFilter) qs.set("status", statusFilter);
      if (search.trim()) qs.set("q", search.trim());
      var data = await request("/billings?" + qs.toString(), null, auth.session);
      setBillings(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load bills");
      setBillings([]);
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.session, statusFilter]
  );

  var filtered = useMemo(
    function () {
      if (!search.trim()) return billings;
      var needle = search.trim().toLowerCase();
      return billings.filter(function (row) {
        return (
          String(row.id || "").toLowerCase().indexOf(needle) >= 0 ||
          String(row.patient_id || "").toLowerCase().indexOf(needle) >= 0
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

  function printBill() {
    if (!bundle?.billing) return;
    var totals = totalsFromBundle(bundle);
    var serviceRows = (bundle.services || [])
      .map(function (s) {
        return (
          "<tr><td>" +
          (s.date || "-") +
          "</td><td>" +
          (s.service_name || "") +
          "</td><td>" +
          (s.partner || "") +
          "</td><td>" +
          (s.count || "") +
          "</td><td>" +
          formatCurrency(s.amt) +
          "</td><td>" +
          formatCurrency(s.total) +
          "</td></tr>"
        );
      })
      .join("");
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
      "<h2>Bill " +
      bundle.billing.id +
      "</h2>" +
      "<div class='meta'><strong>Patient:</strong> " +
      (bundle.billing.patient_id || "-") +
      "</div>" +
      "<div class='meta'><strong>Status:</strong> " +
      (bundle.billing.status || "Active") +
      "</div>" +
      "<h3>Services</h3>" +
      "<table><thead><tr><th>Date</th><th>Service</th><th>Partner</th><th>Count</th><th>Rate</th><th>Total</th></tr></thead><tbody>" +
      (serviceRows || "<tr><td colspan='6'>No entries</td></tr>") +
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
    openPrintWindow("Bill " + bundle.billing.id, body);
  }

  var totals = totalsFromBundle(bundle);
  var status = String(bundle?.billing?.status || "Active");
  var isClosed = status === "Closed" || status === "Cancelled";

  return (
    <AuthGuard permission="billings.read">
      <AppShell title="Billing">
        <div className="page-split">
          <div className="page-grid">
            <ModuleShell title="Open new bill" description="Create an Active bill for a patient. Security deposit can be added now or later.">
              <form className="stack" onSubmit={handleCreate}>
                <div className="grid-2">
                  <div className="field">
                    <label>Patient</label>
                    <select
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
                    <label>Security deposit</label>
                    <input
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
                  <label>Status</label>
                  <select
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
                  <label>Search</label>
                  <input
                    placeholder="bill id / patient id"
                    value={search}
                    onChange={function (event) {
                      setSearch(event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="button secondary" type="button" onClick={reloadList}>
                    Refresh
                  </button>
                </div>
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
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
                            <h3>{row.id}</h3>
                            <div className="record-meta">
                              <span>Patient {row.patient_id}</span>
                              <span>Sec dep {formatCurrency(row.sec_dep)}</span>
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
              title={bundle?.billing ? "Bill " + bundle.billing.id : "Bill detail"}
              description="Services, receipts, totals — all server-computed."
            >
              {!bundle ? (
                <EmptyState
                  title={bundleLoading ? "Loading…" : "Select a bill"}
                  description="Pick any bill on the left to see services, receipts, totals, and actions."
                />
              ) : (
                <div className="stack">
                  <div className="helper-box">
                    <div>
                      <strong>Status:</strong> {status}
                      &nbsp;·&nbsp; <strong>Patient:</strong> {bundle.billing.patient_id || "-"}
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
                      Print
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

                  <form className="stack" onSubmit={handleSecDepSave}>
                    <strong>Security deposit</strong>
                    <div className="grid-2">
                      <div className="field">
                        <label>Amount</label>
                        <input
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
                        <label>&nbsp;</label>
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
                    <div className="grid-2">
                      <div className="field">
                        <label>Type</label>
                        <select
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
                        <label>Method</label>
                        <select
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
                        <label>Amount</label>
                        <input
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
                        <label>Date</label>
                        <input
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
                        <label>Reference</label>
                        <input
                          value={receiptForm.ref}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, ref: event.target.value });
                          }}
                          placeholder="UPI ref / cheque no"
                          disabled={isClosed}
                        />
                      </div>
                      <div className="field">
                        <label>Remarks</label>
                        <input
                          value={receiptForm.remarks}
                          onChange={function (event) {
                            setReceiptForm({ ...receiptForm, remarks: event.target.value });
                          }}
                          disabled={isClosed}
                        />
                      </div>
                    </div>
                    <div className="button-row">
                      <button className="button success" type="submit" disabled={busy || isClosed}>
                        Record receipt
                      </button>
                    </div>
                  </form>

                  <div className="table-wrap">
                    <strong>Receipts ledger</strong>
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Method</th>
                          <th>Amount</th>
                          <th>Ref</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!bundle.receipts || !bundle.receipts.length ? (
                          <tr>
                            <td colSpan="6" className="mini-muted">
                              No receipts recorded.
                            </td>
                          </tr>
                        ) : (
                          bundle.receipts.map(function (r) {
                            return (
                              <tr key={r.id}>
                                <td>{formatDate(r.date)}</td>
                                <td>{r.type}</td>
                                <td>{r.method}</td>
                                <td>{formatCurrency(r.amount)}</td>
                                <td>{r.ref || "-"}</td>
                                <td>{r.remarks || "-"}</td>
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

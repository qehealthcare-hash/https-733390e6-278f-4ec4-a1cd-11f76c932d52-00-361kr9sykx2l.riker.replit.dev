"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { paymentMethodOptions } from "@/lib/crm-options";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";

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
    photo: ""
  };
}

export default function PayoutsPage() {
  var auth = useAuth();
  var [employees, setEmployees] = useState([]);
  var [payouts, setPayouts] = useState([]);
  var [loading, setLoading] = useState(true);
  var [periodFilter, setPeriodFilter] = useState(currentPeriod());
  var [statusFilter, setStatusFilter] = useState("");
  var [employeeFilter, setEmployeeFilter] = useState("");
  var [selectedId, setSelectedId] = useState("");
  var [detail, setDetail] = useState(null);
  var [detailLoading, setDetailLoading] = useState(false);
  var [ensureForm, setEnsureForm] = useState(emptyEnsureForm());
  var [adjustForm, setAdjustForm] = useState(emptyAdjustForm());
  var [payForm, setPayForm] = useState(emptyPayForm());
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
      setMessage("Payout ensured for " + ensureForm.employee_id);
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

  async function handlePay(event) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/pay",
        {
          method: "POST",
          body: {
            payout_id: selectedId,
            paid_on: payForm.paid_on,
            method: payForm.method,
            photo: payForm.photo || ""
          }
        },
        auth.session
      );
      setMessage("Payout marked PAID");
      setPayForm(emptyPayForm());
      await openPayout(selectedId);
      await reloadList();
    } catch (err) {
      setError(err.message || "Could not mark paid");
    } finally {
      setBusy(false);
    }
  }

  function printPayout() {
    if (!detail?.payout) return;
    var row = detail.payout;
    var emp = employees.find(function (e) {
      return e.id === row.employee_id;
    });
    var body =
      "<h2>Payout Statement</h2>" +
      "<div class='meta'><strong>Employee:</strong> " +
      ((emp && (emp.full_name || emp.name)) || row.employee_id) +
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
      "</tbody></table>" +
      (row.paid_at ? "<div class='meta'><strong>Paid on:</strong> " + formatDate(row.paid_at) + "</div>" : "") +
      (row.remarks ? "<div class='meta'><strong>Remarks:</strong> " + row.remarks + "</div>" : "");
    openPrintWindow("Payout " + row.id, body);
  }

  var payout = detail?.payout || null;
  var status = String(payout?.status || "OPEN");
  var isLocked = status === "LOCKED" || status === "PAID";

  return (
    <AuthGuard permission="payouts.read">
      <AppShell title="Payouts">
        <div className="page-split">
          <div className="page-grid">
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
                    var emp = employees.find(function (e) {
                      return e.id === row.employee_id;
                    });
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
                            <h3>{(emp && (emp.full_name || emp.name)) || row.employee_id}</h3>
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
              title={payout ? "Payout " + payout.id : "Payout detail"}
              description="Adjust, lock, recompute, or mark paid."
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
                      <strong>Employee:</strong> {payout.employee_id}
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
                        <strong>Advance:</strong> {formatCurrency(payout.advance)}
                      </div>
                      <div>
                        <strong>Deduction:</strong> {formatCurrency(payout.deduction)}
                      </div>
                      <div>
                        <strong>Bonus:</strong> {formatCurrency(payout.bonus)}
                      </div>
                      <div>
                        <strong>Paid:</strong> {payout.paid_at ? formatDate(payout.paid_at) : "-"}
                      </div>
                    </div>
                  </div>

                  <div className="button-row">
                    <button className="button secondary" type="button" onClick={printPayout}>
                      Print
                    </button>
                    <button className="button secondary" type="button" onClick={handleRecompute} disabled={busy || isLocked}>
                      Recompute
                    </button>
                    {status === "OPEN" ? (
                      <button className="button secondary" type="button" onClick={handleLock} disabled={busy}>
                        Lock
                      </button>
                    ) : null}
                    {status === "LOCKED" ? (
                      <button className="button secondary" type="button" onClick={handleReopen} disabled={busy}>
                        Reopen
                      </button>
                    ) : null}
                  </div>

                  {!isLocked || status === "LOCKED" ? (
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

                  {status === "LOCKED" ? (
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
                          <label>Proof / photo</label>
                          <input
                            value={payForm.photo}
                            onChange={function (event) {
                              setPayForm({ ...payForm, photo: event.target.value });
                            }}
                            placeholder="URL or note"
                          />
                        </div>
                      </div>
                      <div className="button-row">
                        <button className="button success" type="submit" disabled={busy}>
                          Mark paid
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              )}
            </ModuleShell>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

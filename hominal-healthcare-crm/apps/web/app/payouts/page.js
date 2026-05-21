"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { paymentModeOptions } from "@/lib/crm-options";
import { formatCurrency, formatDate, formatMonth } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";

function createEntry() {
  return {
    patient_id: "",
    invoice_item_id: "",
    service_name: "",
    total_days: 0,
    rate_per_day: 0,
    amount: 0
  };
}

function createRunForm() {
  return {
    employee_id: "",
    payout_month: new Date().toISOString().slice(0, 10),
    entries: [createEntry()]
  };
}

function createPaymentForm() {
  return {
    payout_id: "",
    amount_paid: "",
    payment_mode: "UPI",
    payment_date: new Date().toISOString().slice(0, 10),
    proof_file_path: ""
  };
}

export default function PayoutsPage() {
  var auth = useAuth();
  var resource = useRealtimeResource({
    apiPath: "/payouts",
    tables: ["staff_payouts", "payout_runs", "payout_payments", "payout_entries"],
    channel: "payouts"
  });
  var [employees, setEmployees] = useState([]);
  var [patients, setPatients] = useState([]);
  var [runForm, setRunForm] = useState(createRunForm());
  var [paymentForm, setPaymentForm] = useState(createPaymentForm());
  var [selectedPayout, setSelectedPayout] = useState(null);
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      Promise.all([request("/lookups/employees", null, auth.session), request("/lookups/patients", null, auth.session)])
        .then(function (result) {
          setEmployees(result[0]);
          setPatients(result[1]);
        })
        .catch(function () {
          setEmployees([]);
          setPatients([]);
        });
    },
    [auth.session]
  );

  var totalDraftAmount = useMemo(
    function () {
      return runForm.entries.reduce(function (sum, entry) {
        return sum + Number(entry.amount || 0);
      }, 0);
    },
    [runForm.entries]
  );

  function updateRunField(name, value) {
    setRunForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function updateEntry(index, key, value) {
    setRunForm(function (current) {
      var entries = current.entries.slice();
      entries[index] = { ...entries[index], [key]: value };
      return { ...current, entries };
    });
  }

  async function handleRunSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts",
        {
          method: "POST",
          body: {
            employee_id: runForm.employee_id,
            payout_month: runForm.payout_month,
            entries: runForm.entries.map(function (entry) {
              return {
                patient_id: entry.patient_id,
                invoice_item_id: entry.invoice_item_id || null,
                service_name: entry.service_name,
                total_days: Number(entry.total_days || 0),
                rate_per_day: Number(entry.rate_per_day || 0),
                amount: Number(entry.amount || 0)
              };
            })
          }
        },
        auth.session
      );
      await resource.reload();
      setRunForm(createRunForm());
      setMessage("Payout run created");
    } catch (submitError) {
      setError(submitError.message || "Unable to create payout run");
    } finally {
      setBusy(false);
    }
  }

  async function openPayout(id) {
    setBusy(true);
    try {
      var data = await request("/payouts/" + id, null, auth.session);
      setSelectedPayout(data);
      setPaymentForm(function (current) {
        return { ...current, payout_id: id };
      });
    } catch (loadError) {
      setError(loadError.message || "Unable to load payout detail");
    } finally {
      setBusy(false);
    }
  }

  async function handlePaymentSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/payouts/payments",
        {
          method: "POST",
          body: {
            payout_id: paymentForm.payout_id,
            amount_paid: Number(paymentForm.amount_paid),
            payment_mode: paymentForm.payment_mode,
            payment_date: paymentForm.payment_date,
            proof_file_path: paymentForm.proof_file_path || null
          }
        },
        auth.session
      );
      await resource.reload();
      if (selectedPayout?.id) {
        await openPayout(selectedPayout.id);
      }
      setPaymentForm(createPaymentForm());
      setMessage("Payout payment recorded");
    } catch (paymentError) {
      setError(paymentError.message || "Unable to record payout payment");
    } finally {
      setBusy(false);
    }
  }

  function printPayout(payout) {
    var rows = (payout.payout_entries || [])
      .map(function (entry) {
        return (
          "<tr><td>" +
          (entry.patients?.full_name || "-") +
          "</td><td>" +
          entry.service_name +
          "</td><td>" +
          entry.total_days +
          "</td><td>" +
          formatCurrency(entry.rate_per_day) +
          "</td><td>" +
          formatCurrency(entry.amount) +
          "</td></tr>"
        );
      })
      .join("");
    var body =
      "<h2>Payout Statement</h2>" +
      "<div class='meta'><strong>Employee:</strong> " +
      (payout.employees?.full_name || "-") +
      "</div>" +
      "<div class='meta'><strong>Month:</strong> " +
      formatMonth(payout.payout_month) +
      "</div>" +
      "<table><thead><tr><th>Patient</th><th>Service</th><th>Days</th><th>Rate/Day</th><th>Amount</th></tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      "<div class='meta'><strong>Total Payable:</strong> " +
      formatCurrency(payout.total_amount) +
      "</div><div class='meta'><strong>Pending:</strong> " +
      formatCurrency(payout.pending_amount) +
      "</div>";
    openPrintWindow("Payout " + payout.id, body);
  }

  async function openPayoutAndPrint(id) {
    setBusy(true);
    try {
      var data = await request("/payouts/" + id, null, auth.session);
      printPayout(data);
    } catch (printError) {
      setError(printError.message || "Unable to print payout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="payouts.read">
      <AppShell title="Payouts">
        <div className="page-split">
          <div className="page-grid">
            <ModuleShell title="Create Payout Run" description="Separate payout ledger per employee with multi-patient breakdown">
              <form className="stack" onSubmit={handleRunSubmit}>
                <div className="grid-2">
                  <div className="field">
                    <label>Employee</label>
                    <select value={runForm.employee_id} onChange={function (event) { updateRunField("employee_id", event.target.value); }} required>
                      <option value="">Select employee</option>
                      {employees.map(function (employee) {
                        return <option key={employee.id} value={employee.id}>{employee.full_name}</option>;
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Payout Month</label>
                    <input type="date" value={runForm.payout_month} onChange={function (event) { updateRunField("payout_month", event.target.value); }} required />
                  </div>
                </div>
                {runForm.entries.map(function (entry, index) {
                  return (
                    <div className="panel detail-card" key={index}>
                      <div className="grid-2">
                        <div className="field">
                          <label>Patient</label>
                          <select value={entry.patient_id} onChange={function (event) { updateEntry(index, "patient_id", event.target.value); }}>
                            <option value="">Select patient</option>
                            {patients.map(function (patient) {
                              return <option key={patient.id} value={patient.id}>{patient.full_name}</option>;
                            })}
                          </select>
                        </div>
                        <div className="field">
                          <label>Service</label>
                          <input value={entry.service_name} onChange={function (event) { updateEntry(index, "service_name", event.target.value); }} required />
                        </div>
                        <div className="field">
                          <label>Total Days</label>
                          <input type="number" min="0" value={entry.total_days} onChange={function (event) { updateEntry(index, "total_days", event.target.value); }} required />
                        </div>
                        <div className="field">
                          <label>Rate per Day</label>
                          <input type="number" min="0" value={entry.rate_per_day} onChange={function (event) { updateEntry(index, "rate_per_day", event.target.value); }} required />
                        </div>
                        <div className="field">
                          <label>Amount</label>
                          <input type="number" min="0" value={entry.amount} onChange={function (event) { updateEntry(index, "amount", event.target.value); }} required />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="helper-box">Draft total payable: {formatCurrency(totalDraftAmount)}</div>
                <div className="button-row">
                  <button className="button secondary" type="button" onClick={function () { setRunForm(function (current) { return { ...current, entries: current.entries.concat(createEntry()) }; }); }}>
                    Add Patient Breakdown
                  </button>
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "Saving..." : "Create Payout Run"}
                  </button>
                </div>
              </form>
            </ModuleShell>

            <ModuleShell title="Record Partial Payment" description="Carry forward pending amounts automatically">
              <form className="stack" onSubmit={handlePaymentSubmit}>
                <div className="grid-2">
                  <div className="field">
                    <label>Payout Run</label>
                    <select value={paymentForm.payout_id} onChange={function (event) { setPaymentForm({ ...paymentForm, payout_id: event.target.value }); }} required>
                      <option value="">Select payout run</option>
                      {resource.data.map(function (row) {
                        return <option key={row.id} value={row.id}>{row.employees?.full_name || row.employee_id} - {formatMonth(row.payout_month)}</option>;
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Amount Paid</label>
                    <input type="number" min="0.01" value={paymentForm.amount_paid} onChange={function (event) { setPaymentForm({ ...paymentForm, amount_paid: event.target.value }); }} required />
                  </div>
                  <div className="field">
                    <label>Payment Mode</label>
                    <select value={paymentForm.payment_mode} onChange={function (event) { setPaymentForm({ ...paymentForm, payment_mode: event.target.value }); }}>
                      {paymentModeOptions.map(function (item) {
                        return <option key={item.value} value={item.value}>{item.label}</option>;
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Payment Date</label>
                    <input type="date" value={paymentForm.payment_date} onChange={function (event) { setPaymentForm({ ...paymentForm, payment_date: event.target.value }); }} required />
                  </div>
                </div>
                <div className="field">
                  <label>Proof File Path</label>
                  <input value={paymentForm.proof_file_path} onChange={function (event) { setPaymentForm({ ...paymentForm, proof_file_path: event.target.value }); }} placeholder="Optional payout proof path or signed upload file path" />
                </div>
                {error ? <div className="error-text">{error}</div> : null}
                {message ? <div className="success-text">{message}</div> : null}
                <button className="button success" type="submit" disabled={busy}>
                  Record Payment
                </button>
              </form>
            </ModuleShell>
          </div>

          <div className="page-grid">
            <ModuleShell title="Payout Ledger" description="Monthly staff payouts, pending balances, and detailed patient work breakdown">
              {!resource.data.length ? (
                <EmptyState title={resource.loading ? "Loading payouts..." : "No payout runs"} description="Monthly payout ledgers will show here with patient-wise breakdown." />
              ) : (
                <div className="record-list">
                  {resource.data.map(function (row) {
                    return (
                      <div className="record-card" key={row.id}>
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>{row.employees?.full_name || "Employee"}</h3>
                            <div className="record-meta">
                              <span>{formatMonth(row.payout_month)}</span>
                              <span>Total {formatCurrency(row.total_amount)}</span>
                              <span>Pending {formatCurrency(row.pending_amount)}</span>
                            </div>
                          </div>
                          <span className={"status " + (Number(row.pending_amount || 0) > 0 ? "paused" : "active")}>
                            {Number(row.pending_amount || 0) > 0 ? "Pending" : "Settled"}
                          </span>
                        </div>
                        <div className="button-row" style={{ marginTop: 12 }}>
                          <button className="button secondary" type="button" onClick={function () { openPayout(row.id); }}>
                            Details
                          </button>
                          <button className="button secondary" type="button" onClick={function () { openPayoutAndPrint(row.id); }}>
                            Print PDF
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModuleShell>

            {selectedPayout ? (
              <ModuleShell title="Payout Detail" description="Employee-wise monthly service and payment history">
                <div className="helper-box">
                  {selectedPayout.employees?.full_name} | {formatMonth(selectedPayout.payout_month)} | Pending {formatCurrency(selectedPayout.pending_amount)}
                </div>
                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Service</th>
                        <th>Days</th>
                        <th>Rate / Day</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedPayout.payout_entries || []).map(function (entry) {
                        return (
                          <tr key={entry.id}>
                            <td>{entry.patients?.full_name || "-"}</td>
                            <td>{entry.service_name}</td>
                            <td>{entry.total_days}</td>
                            <td>{formatCurrency(entry.rate_per_day)}</td>
                            <td>{formatCurrency(entry.amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="stack" style={{ marginTop: 16 }}>
                  <strong>Payment History</strong>
                  {!(selectedPayout.payout_payments || []).length ? (
                    <div className="mini-muted">No payments recorded yet.</div>
                  ) : (
                    <div className="record-list">
                      {selectedPayout.payout_payments.map(function (payment) {
                        return (
                          <div className="document-item" key={payment.id}>
                            <div>{formatDate(payment.payment_date)} | {payment.payment_mode} | {formatCurrency(payment.amount_paid)}</div>
                            <div className="mini-muted">{payment.proof_file_path || "No proof attached"}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ModuleShell>
            ) : null}
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

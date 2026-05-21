"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { closeReasonOptions, invoiceStatusOptions, invoiceTypeOptions, paymentModeOptions } from "@/lib/crm-options";
import { formatCurrency, formatDate, formatMonth } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";

function createItem() {
  return {
    service_name: "Home Healthcare Service",
    assigned_staff_id: "",
    duration_label: "Monthly",
    total_days: 30,
    total_people: 1,
    rate_per_day: 0,
    absent_days: 0
  };
}

function createInvoiceForm() {
  return {
    patient_id: "",
    service_month: new Date().toISOString().slice(0, 10),
    invoice_type: "PROVISIONAL",
    security_deposit: 0,
    status: "OPEN",
    close_reason: "",
    items: [createItem()]
  };
}

function monthDateBounds(serviceMonth) {
  var base = serviceMonth ? new Date(serviceMonth + "T00:00:00.000Z") : new Date();
  if (Number.isNaN(base.getTime())) {
    base = new Date();
  }
  var y = base.getUTCFullYear();
  var m = base.getUTCMonth();
  var start = new Date(Date.UTC(y, m, 1));
  var end = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10)
  };
}

function createReceiptForm() {
  return {
    invoice_id: "",
    service_name: "",
    from_date: "",
    to_date: "",
    amount: "",
    payment_mode: "UPI",
    received_on: new Date().toISOString().slice(0, 10),
    note: ""
  };
}

export default function BillingsPage() {
  var auth = useAuth();
  var resource = useRealtimeResource({
    apiPath: "/billings",
    tables: ["invoices", "billing_receipts", "patient_services", "receipts"],
    channel: "billings"
  });
  var [patients, setPatients] = useState([]);
  var [employees, setEmployees] = useState([]);
  var [invoiceForm, setInvoiceForm] = useState(createInvoiceForm());
  var [receiptForm, setReceiptForm] = useState(createReceiptForm());
  var [selectedInvoice, setSelectedInvoice] = useState(null);
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [statusFilter, setStatusFilter] = useState("");

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      Promise.all([request("/lookups/patients", null, auth.session), request("/lookups/employees", null, auth.session)])
        .then(function (result) {
          setPatients(result[0]);
          setEmployees(result[1]);
        })
        .catch(function () {
          setPatients([]);
          setEmployees([]);
        });
    },
    [auth.session]
  );

  var filtered = useMemo(
    function () {
      return resource.data.filter(function (row) {
        return !statusFilter || row.status === statusFilter;
      });
    },
    [resource.data, statusFilter]
  );

  function updateInvoiceField(name, value) {
    setInvoiceForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function updateItem(index, key, value) {
    setInvoiceForm(function (current) {
      var items = current.items.slice();
      items[index] = { ...items[index], [key]: value };
      return { ...current, items };
    });
  }

  function resetInvoiceForm() {
    setInvoiceForm(createInvoiceForm());
  }

  async function handleInvoiceSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        "/billings",
        {
          method: "POST",
          body: {
            patient_id: invoiceForm.patient_id,
            service_month: invoiceForm.service_month,
            invoice_type: invoiceForm.invoice_type,
            security_deposit: Number(invoiceForm.security_deposit || 0),
            status: invoiceForm.status,
            close_reason: invoiceForm.status === "CLOSED" ? invoiceForm.close_reason : null,
            items: invoiceForm.items.map(function (item) {
              return {
                service_name: item.service_name,
                assigned_staff_id: item.assigned_staff_id || null,
                duration_label: item.duration_label,
                total_days: Number(item.total_days || 0),
                total_people: Number(item.total_people || 1),
                rate_per_day: Number(item.rate_per_day || 0),
                absent_days: Number(item.absent_days || 0)
              };
            })
          }
        },
        auth.session
      );
      await resource.reload();
      setMessage("Invoice created successfully");
      resetInvoiceForm();
    } catch (submitError) {
      setError(submitError.message || "Unable to create invoice");
    } finally {
      setBusy(false);
    }
  }

  async function openInvoice(id) {
    setBusy(true);
    try {
      var data = await request("/billings/" + id, null, auth.session);
      setSelectedInvoice(data);
      var bounds = monthDateBounds(data.service_month);
      var defaultService =
        (data.invoice_items && data.invoice_items[0] && data.invoice_items[0].service_name) || "";
      setReceiptForm({
        ...createReceiptForm(),
        invoice_id: id,
        service_name: defaultService,
        from_date: bounds.from,
        to_date: bounds.to,
        received_on: new Date().toISOString().slice(0, 10)
      });
    } catch (loadError) {
      setError(loadError.message || "Unable to load invoice details");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(invoice, nextStatus) {
    var closeReason = invoice.close_reason || "";
    if (nextStatus === "CLOSED") {
      closeReason = window.prompt("Reason for closing this bill", closeReason || closeReasonOptions[0]) || "";
      if (!closeReason) return;
    }
    setBusy(true);
    try {
      await requestWithOfflineFallback(
        "/billings/" + invoice.id + "/status",
        {
          method: "PATCH",
          body: {
            status: nextStatus,
            close_reason: nextStatus === "CLOSED" ? closeReason : null
          }
        },
        auth.session
      );
      await resource.reload();
      if (selectedInvoice?.id === invoice.id) {
        await openInvoice(invoice.id);
      }
      setMessage("Invoice status updated");
    } catch (statusError) {
      setError(statusError.message || "Unable to update invoice status");
    } finally {
      setBusy(false);
    }
  }

  async function handleReceiptSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/billings/receipts",
        {
          method: "POST",
          body: {
            invoice_id: receiptForm.invoice_id,
            service_name: receiptForm.service_name || undefined,
            from_date: receiptForm.from_date || undefined,
            to_date: receiptForm.to_date || undefined,
            amount: Number(receiptForm.amount),
            payment_mode: receiptForm.payment_mode,
            received_on: receiptForm.received_on,
            note: receiptForm.note
          }
        },
        auth.session
      );
      await resource.reload();
      if (selectedInvoice?.id) {
        await openInvoice(selectedInvoice.id);
      }
      setReceiptForm(createReceiptForm());
      setMessage("Receipt added");
    } catch (receiptError) {
      setError(receiptError.message || "Unable to add receipt");
    } finally {
      setBusy(false);
    }
  }

  function printInvoice(invoice) {
    var rows = (invoice.invoice_items || [])
      .map(function (item) {
        return (
          "<tr><td>" +
          item.service_name +
          "</td><td>" +
          item.duration_label +
          "</td><td>" +
          item.total_days +
          "</td><td>" +
          item.total_people +
          "</td><td>" +
          formatCurrency(item.line_total) +
          "</td></tr>"
        );
      })
      .join("");
    var body =
      "<h2>" +
      invoice.invoice_type +
      " Invoice</h2>" +
      "<div class='meta'><strong>Patient:</strong> " +
      (invoice.patients?.full_name || "-") +
      "</div>" +
      "<div class='meta'><strong>Month:</strong> " +
      formatMonth(invoice.service_month) +
      "</div>" +
      "<table><thead><tr><th>Service</th><th>Duration</th><th>Total Days</th><th>Total People</th><th>Total</th></tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      "<div class='meta'><strong>Subtotal:</strong> " +
      formatCurrency(invoice.subtotal_amount) +
      "</div>" +
      "<div class='meta'><strong>Outstanding:</strong> " +
      formatCurrency(invoice.outstanding_amount) +
      "</div>";
    openPrintWindow("Invoice " + invoice.id, body);
  }

  async function openInvoiceAndPrint(id) {
    setBusy(true);
    try {
      var data = await request("/billings/" + id, null, auth.session);
      printInvoice(data);
    } catch (printError) {
      setError(printError.message || "Unable to print invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="billings.read">
      <AppShell title="Billing">
        <div className="page-split">
          <div className="page-grid">
            <ModuleShell title="Create Invoice" description="Patient-linked invoice generation with deposit, service, duration, and absent-day support">
              <form className="stack" onSubmit={handleInvoiceSubmit}>
                <div className="grid-2">
                  <div className="field">
                    <label>Patient</label>
                    <select value={invoiceForm.patient_id} onChange={function (event) { updateInvoiceField("patient_id", event.target.value); }} required>
                      <option value="">Select patient</option>
                      {patients.map(function (patient) {
                        return <option key={patient.id} value={patient.id}>{patient.full_name} ({patient.mobile})</option>;
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Service Month</label>
                    <input type="date" value={invoiceForm.service_month} onChange={function (event) { updateInvoiceField("service_month", event.target.value); }} required />
                  </div>
                  <div className="field">
                    <label>Invoice Type</label>
                    <select value={invoiceForm.invoice_type} onChange={function (event) { updateInvoiceField("invoice_type", event.target.value); }}>
                      {invoiceTypeOptions.map(function (item) {
                        return <option key={item.value} value={item.value}>{item.label}</option>;
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Security Deposit</label>
                    <input type="number" min="0" value={invoiceForm.security_deposit} onChange={function (event) { updateInvoiceField("security_deposit", event.target.value); }} />
                  </div>
                </div>
                {invoiceForm.items.map(function (item, index) {
                  return (
                    <div className="panel detail-card" key={index}>
                      <div className="grid-2">
                        <div className="field">
                          <label>Service</label>
                          <input value={item.service_name} onChange={function (event) { updateItem(index, "service_name", event.target.value); }} required />
                        </div>
                        <div className="field">
                          <label>Assigned Staff</label>
                          <select value={item.assigned_staff_id} onChange={function (event) { updateItem(index, "assigned_staff_id", event.target.value); }}>
                            <option value="">Select staff</option>
                            {employees.map(function (employee) {
                              return <option key={employee.id} value={employee.id}>{employee.full_name}</option>;
                            })}
                          </select>
                        </div>
                        <div className="field">
                          <label>Duration Label</label>
                          <input value={item.duration_label} onChange={function (event) { updateItem(index, "duration_label", event.target.value); }} />
                        </div>
                        <div className="field">
                          <label>Rate per Day</label>
                          <input type="number" min="0" value={item.rate_per_day} onChange={function (event) { updateItem(index, "rate_per_day", event.target.value); }} required />
                        </div>
                        <div className="field">
                          <label>Total Days</label>
                          <input type="number" min="0" value={item.total_days} onChange={function (event) { updateItem(index, "total_days", event.target.value); }} required />
                        </div>
                        <div className="field">
                          <label>Total People</label>
                          <input type="number" min="1" value={item.total_people} onChange={function (event) { updateItem(index, "total_people", event.target.value); }} required />
                        </div>
                        <div className="field">
                          <label>Absent Days</label>
                          <input type="number" min="0" value={item.absent_days} onChange={function (event) { updateItem(index, "absent_days", event.target.value); }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="button-row">
                  <button className="button secondary" type="button" onClick={function () { setInvoiceForm(function (current) { return { ...current, items: current.items.concat(createItem()) }; }); }}>
                    Add Service Line
                  </button>
                </div>
                {error ? <div className="error-text">{error}</div> : null}
                {message ? <div className="success-text">{message}</div> : null}
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "Saving..." : "Generate Invoice"}
                  </button>
                  <button className="button secondary" type="button" onClick={resetInvoiceForm}>
                    Reset
                  </button>
                </div>
              </form>
            </ModuleShell>

            <ModuleShell title="Add Receipt" description="Day-level invoices need the service type and paid date range; older invoices accept amount only.">
              <form className="stack" onSubmit={handleReceiptSubmit}>
                <div className="grid-2">
                  <div className="field">
                    <label>Invoice</label>
                    <select
                      value={receiptForm.invoice_id}
                      onChange={function (event) {
                        var id = event.target.value;
                        var inv = resource.data.find(function (row) {
                          return row.id === id;
                        });
                        if (inv) {
                          var b = monthDateBounds(inv.service_month);
                          var ds =
                            (inv.invoice_items && inv.invoice_items[0] && inv.invoice_items[0].service_name) || "";
                          setReceiptForm({
                            ...createReceiptForm(),
                            invoice_id: id,
                            service_name: ds,
                            from_date: b.from,
                            to_date: b.to,
                            received_on: new Date().toISOString().slice(0, 10)
                          });
                        } else {
                          setReceiptForm({ ...createReceiptForm(), invoice_id: id });
                        }
                      }}
                      required
                    >
                      <option value="">Select invoice</option>
                      {resource.data.map(function (invoice) {
                        return <option key={invoice.id} value={invoice.id}>{invoice.patients?.full_name || invoice.patient_id} - {formatMonth(invoice.service_month)}</option>;
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Service type (for day-level billing)</label>
                    <input
                      value={receiptForm.service_name}
                      onChange={function (event) {
                        setReceiptForm({ ...receiptForm, service_name: event.target.value });
                      }}
                      placeholder="Match invoice line service name"
                    />
                  </div>
                  <div className="field">
                    <label>Paid from</label>
                    <input type="date" value={receiptForm.from_date} onChange={function (event) { setReceiptForm({ ...receiptForm, from_date: event.target.value }); }} />
                  </div>
                  <div className="field">
                    <label>Paid to</label>
                    <input type="date" value={receiptForm.to_date} onChange={function (event) { setReceiptForm({ ...receiptForm, to_date: event.target.value }); }} />
                  </div>
                  <div className="field">
                    <label>Amount</label>
                    <input type="number" min="0.01" value={receiptForm.amount} onChange={function (event) { setReceiptForm({ ...receiptForm, amount: event.target.value }); }} required />
                  </div>
                  <div className="field">
                    <label>Mode</label>
                    <select value={receiptForm.payment_mode} onChange={function (event) { setReceiptForm({ ...receiptForm, payment_mode: event.target.value }); }}>
                      {paymentModeOptions.map(function (item) {
                        return <option key={item.value} value={item.value}>{item.label}</option>;
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Received On</label>
                    <input type="date" value={receiptForm.received_on} onChange={function (event) { setReceiptForm({ ...receiptForm, received_on: event.target.value }); }} required />
                  </div>
                </div>
                <div className="field">
                  <label>Note</label>
                  <textarea rows="2" value={receiptForm.note} onChange={function (event) { setReceiptForm({ ...receiptForm, note: event.target.value }); }} />
                </div>
                <button className="button success" type="submit" disabled={busy}>
                  Record Receipt
                </button>
              </form>
            </ModuleShell>
          </div>

          <div className="page-grid">
            <ModuleShell title="Invoice Ledger" description="Realtime invoice history, collections, and close workflow">
              <div className="toolbar">
                <div className="field">
                  <label>Status</label>
                  <select value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                    <option value="">All</option>
                    {invoiceStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
              </div>
              {!filtered.length ? (
                <EmptyState title={resource.loading ? "Loading invoices..." : "No invoices found"} description="Generated patient invoices and collections will appear here." />
              ) : (
                <div className="record-list">
                  {filtered.map(function (invoice) {
                    return (
                      <div className="record-card" key={invoice.id}>
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>{invoice.patients?.full_name || "Patient Invoice"}</h3>
                            <div className="record-meta">
                              <span>{formatMonth(invoice.service_month)}</span>
                              <span>{invoice.invoice_type}</span>
                              <span>{formatCurrency(invoice.subtotal_amount)}</span>
                            </div>
                          </div>
                          <span className={"status " + String(invoice.status || "").toLowerCase()}>{invoice.status}</span>
                        </div>
                        <div className="record-meta" style={{ marginTop: 12 }}>
                          <span>Outstanding {formatCurrency(invoice.outstanding_amount)}</span>
                          <span>Deposit {formatCurrency(invoice.security_deposit)}</span>
                        </div>
                        <div className="button-row" style={{ marginTop: 12 }}>
                          <button className="button secondary" type="button" onClick={function () { openInvoice(invoice.id); }}>
                            Details
                          </button>
                          <button className="button secondary" type="button" onClick={function () { openInvoiceAndPrint(invoice.id); }}>
                            Print PDF
                          </button>
                          <button className="button secondary" type="button" onClick={function () { changeStatus(invoice, "PAUSED"); }}>
                            Pause
                          </button>
                          <button className="button danger" type="button" onClick={function () { changeStatus(invoice, "CLOSED"); }}>
                            Close
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModuleShell>

            {selectedInvoice ? (
              <ModuleShell title="Invoice Detail" description="Collections, service lines, and patient-linked billing history">
                <div className="helper-box">
                  {selectedInvoice.patients?.full_name} | {formatMonth(selectedInvoice.service_month)} | Outstanding {formatCurrency(selectedInvoice.outstanding_amount)}
                </div>
                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Staff</th>
                        <th>Days</th>
                        <th>Absent</th>
                        <th>Rate</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedInvoice.invoice_items || []).map(function (item) {
                        return (
                          <tr key={item.id}>
                            <td>{item.service_name}</td>
                            <td>{item.employees?.full_name || "-"}</td>
                            <td>{item.total_days}</td>
                            <td>{item.absent_days}</td>
                            <td>{formatCurrency(item.rate_per_day)}</td>
                            <td>{formatCurrency(item.line_total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="stack" style={{ marginTop: 16 }}>
                  <strong>Receipts</strong>
                  {!(selectedInvoice.active_receipts || selectedInvoice.receipts || []).length ? (
                    <div className="mini-muted">No receipts recorded yet.</div>
                  ) : (
                    <div className="record-list">
                      {(selectedInvoice.active_receipts || selectedInvoice.receipts || []).map(function (receipt) {
                        return (
                          <div className="document-item" key={receipt.id}>
                            <div>
                              {formatDate(receipt.received_on)} | {receipt.payment_mode} | {formatCurrency(receipt.amount)}
                              {receipt.service_name ? <span className="mini-muted"> | {receipt.service_name}</span> : null}
                            </div>
                            <div className="mini-muted">{receipt.note || "No note"}</div>
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

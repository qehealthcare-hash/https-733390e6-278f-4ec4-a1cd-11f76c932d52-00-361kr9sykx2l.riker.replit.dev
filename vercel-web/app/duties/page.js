"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { formatDate } from "@/lib/formatters";

var DUTY_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"];

function createInitialForm() {
  var start = new Date();
  start.setMinutes(0, 0, 0);
  var end = new Date(start.getTime() + 8 * 60 * 60 * 1000);
  return {
    id: "",
    patient_id: "",
    employee_id: "",
    service_type: "",
    shift_type: "DAY",
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: "SCHEDULED",
    notes: ""
  };
}

export default function DutiesPage() {
  var auth = useAuth();
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [patients, setPatients] = useState([]);
  var [employees, setEmployees] = useState([]);
  var [form, setForm] = useState(createInitialForm());
  var [statusFilter, setStatusFilter] = useState("");
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  async function reload() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var path = "/duties?limit=200";
      if (statusFilter) path += "&status=" + encodeURIComponent(statusFilter);
      var data = await request(path, null, auth.session);
      setRows(Array.isArray(data && data.rows) ? data.rows : []);
      setError("");
    } catch (err) {
      setError(err.message || "Unable to load duties");
    } finally {
      setLoading(false);
    }
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reload();
      Promise.all([
        request("/lookups/patients", null, auth.session),
        request("/lookups/employees", null, auth.session)
      ])
        .then(function (result) {
          setPatients(result[0] || []);
          setEmployees(result[1] || []);
        })
        .catch(function (lookupError) {
          setPatients([]);
          setEmployees([]);
          setError(
            "Could not load patient / employee lookups — " +
              (lookupError.message || "unknown error") +
              ". Dropdowns will be empty until you reload."
          );
        });
    },
    [auth.session, statusFilter]
  );

  var filtered = useMemo(
    function () {
      return rows.slice().sort(function (a, b) {
        return String(b.start_at || "").localeCompare(String(a.start_at || ""));
      });
    },
    [rows]
  );

  function updateField(name, value) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setError("");
    setMessage("");
  }

  function editDuty(row) {
    setForm({
      id: row.id,
      patient_id: row.patient_id || "",
      employee_id: row.employee_id || "",
      service_type: row.service_type || "",
      shift_type: row.shift_type || "DAY",
      start_at: row.start_at || "",
      end_at: row.end_at || "",
      status: row.status || "SCHEDULED",
      notes: row.notes || ""
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      var payload = {
        patient_id: form.patient_id,
        employee_id: form.employee_id,
        service_type: form.service_type,
        shift_type: form.shift_type,
        start_at: form.start_at,
        end_at: form.end_at,
        status: form.status,
        notes: form.notes
      };
      if (form.id) {
        await requestWithOfflineFallback(
          "/duties/" + encodeURIComponent(form.id),
          { method: "PATCH", body: payload },
          auth.session
        );
      } else {
        await requestWithOfflineFallback("/duties", { method: "POST", body: payload }, auth.session);
      }
      await reload();
      resetForm();
      setMessage(form.id ? "Duty updated" : "Duty scheduled");
    } catch (submitError) {
      setError(submitError.message || "Unable to save duty");
    } finally {
      setBusy(false);
    }
  }

  async function runDutyAction(id, action) {
    setBusy(true);
    setError("");
    try {
      await request("/duties/" + encodeURIComponent(id) + "/" + action, { method: "POST", body: {} }, auth.session);
      await reload();
      setMessage("Duty " + action.replace("-", " "));
    } catch (actionError) {
      setError(actionError.message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancelDuty(id) {
    var reason = window.prompt("Cancellation reason (optional):") || "";
    setBusy(true);
    try {
      await request(
        "/duties/" + encodeURIComponent(id) + "/cancel",
        { method: "POST", body: { reason: reason } },
        auth.session
      );
      await reload();
      setMessage("Duty cancelled");
    } catch (cancelError) {
      setError(cancelError.message || "Unable to cancel");
    } finally {
      setBusy(false);
    }
  }

  async function generateBillFromDuty(row) {
    var serviceName = window.prompt(
      "Service name for the billing entry",
      row.service_type || "Caretaker"
    );
    if (!serviceName) return;
    setBusy(true);
    setError("");
    try {
      var data = await requestWithOfflineFallback(
        "/billings/generate",
        {
          method: "POST",
          body: { duty_id: row.id, service_name: serviceName }
        },
        auth.session
      );
      if (data && data.duplicate) {
        setMessage("Duty already billed — entry reused");
      } else {
        setMessage("Billing entry generated");
      }
      await reload();
    } catch (err) {
      setError(err.message || "Could not generate billing entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="duties.read">
      <AppShell title="Duty calendar">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit duty" : "Schedule duty"}
            description="hh_duties calendar — check-in/out and status transitions are audited server-side"
          >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label>Patient</label>
                  <select
                    value={form.patient_id}
                    onChange={function (event) {
                      updateField("patient_id", event.target.value);
                    }}
                    required
                  >
                    <option value="">Select patient</option>
                    {patients.map(function (p) {
                      return (
                        <option key={p.id} value={p.id}>
                          {(p.name || p.full_name) + " (" + p.id + ")"}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Employee</label>
                  <select
                    value={form.employee_id}
                    onChange={function (event) {
                      updateField("employee_id", event.target.value);
                    }}
                    required
                  >
                    <option value="">Select staff</option>
                    {employees.map(function (e) {
                      return (
                        <option key={e.id} value={e.id}>
                          {(e.full_name || e.name) + " (" + e.id + ")"}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Shift</label>
                  <select
                    value={form.shift_type}
                    onChange={function (event) {
                      updateField("shift_type", event.target.value);
                    }}
                  >
                    <option value="DAY">Day</option>
                    <option value="NIGHT">Night</option>
                    <option value="24H">24H</option>
                    <option value="FULL">Full</option>
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    value={form.status}
                    onChange={function (event) {
                      updateField("status", event.target.value);
                    }}
                  >
                    {DUTY_STATUSES.map(function (s) {
                      return (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Start (ISO)</label>
                  <input
                    value={form.start_at}
                    onChange={function (event) {
                      updateField("start_at", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label>End (ISO)</label>
                  <input
                    value={form.end_at}
                    onChange={function (event) {
                      updateField("end_at", event.target.value);
                    }}
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label>Service / notes</label>
                <input
                  value={form.service_type}
                  placeholder="Service type"
                  onChange={function (event) {
                    updateField("service_type", event.target.value);
                  }}
                />
                <textarea
                  rows="2"
                  value={form.notes}
                  onChange={function (event) {
                    updateField("notes", event.target.value);
                  }}
                  placeholder="Notes"
                  style={{ marginTop: 8 }}
                />
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving…" : form.id ? "Update duty" : "Create duty"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell
            title="Scheduled duties"
            description="New calendar table (separate from legacy duty diary in Classic CRM)"
            actions={
              <button className="button secondary" type="button" onClick={reload}>
                Refresh
              </button>
            }
          >
            <div className="toolbar">
              <div className="field">
                <label>Status filter</label>
                <select
                  value={statusFilter}
                  onChange={function (event) {
                    setStatusFilter(event.target.value);
                  }}
                >
                  <option value="">All</option>
                  {DUTY_STATUSES.map(function (s) {
                    return (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            {!filtered.length ? (
              <EmptyState
                title={loading ? "Loading duties…" : "No duties"}
                description="Schedule patient visits from this screen. Legacy service-entry diary remains under Classic CRM."
              />
            ) : (
              <div className="record-list">
                {filtered.map(function (row) {
                  return (
                    <div className="record-card" key={row.id}>
                      <div className="button-row" style={{ justifyContent: "space-between" }}>
                        <div>
                          <h3>{row.patient_id}</h3>
                          <div className="record-meta">
                            <span>{row.employee_id}</span>
                            <span>{row.shift_type}</span>
                            <span className={"status " + String(row.status || "").toLowerCase()}>{row.status}</span>
                          </div>
                          <div className="mini-muted" style={{ marginTop: 8 }}>
                            {formatDate(row.start_at)} → {formatDate(row.end_at)}
                          </div>
                        </div>
                        <div className="button-row">
                          <button className="button secondary" type="button" onClick={function () { editDuty(row); }}>
                            Edit
                          </button>
                          {row.status === "SCHEDULED" ? (
                            <button
                              className="button success"
                              type="button"
                              disabled={busy}
                              onClick={function () { runDutyAction(row.id, "check-in"); }}
                            >
                              Check in
                            </button>
                          ) : null}
                          {row.status === "IN_PROGRESS" ? (
                            <button
                              className="button success"
                              type="button"
                              disabled={busy}
                              onClick={function () { runDutyAction(row.id, "check-out"); }}
                            >
                              Check out
                            </button>
                          ) : null}
                          {row.status === "COMPLETED" || row.status === "IN_PROGRESS" ? (
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busy}
                              onClick={function () { generateBillFromDuty(row); }}
                              title="Generate a service-entry in the patient's active bill"
                            >
                              Bill it
                            </button>
                          ) : null}
                          {row.status !== "CANCELLED" && row.status !== "COMPLETED" ? (
                            <button className="button danger" type="button" disabled={busy} onClick={function () { cancelDuty(row.id); }}>
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ModuleShell>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

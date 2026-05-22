"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { formatDate } from "@/lib/formatters";

var ATTENDANCE_STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "ABSENT", label: "Absent" },
  { value: "LATE", label: "Late" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "LEAVE", label: "Leave" },
  { value: "HOLIDAY", label: "Holiday" }
];

var SHIFT_TYPES = [
  { value: "DAY", label: "Day (9-7)" },
  { value: "NIGHT", label: "Night (8-8)" },
  { value: "24H", label: "24 hours" },
  { value: "FULL", label: "Full" }
];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeek() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  var dow = d.getDay();
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

function isoDateTime(date, time) {
  if (!date) return "";
  if (!time) return new Date(date + "T09:00:00").toISOString();
  return new Date(date + "T" + time + ":00").toISOString();
}

function emptyMarkForm() {
  return {
    duty_id: "",
    employee_id: "",
    patient_id: "",
    shift_type: "DAY",
    work_date: todayDate(),
    check_in_time: "09:00",
    check_out_time: "",
    status: "PRESENT",
    notes: ""
  };
}

export default function AttendancePage() {
  var auth = useAuth();
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [employees, setEmployees] = useState([]);
  var [patients, setPatients] = useState([]);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [from, setFrom] = useState(startOfWeek());
  var [to, setTo] = useState(todayDate());
  var [statusFilter, setStatusFilter] = useState("");
  var [employeeFilter, setEmployeeFilter] = useState("");
  var [missing, setMissing] = useState([]);
  var [missingFor, setMissingFor] = useState("");
  var [form, setForm] = useState(emptyMarkForm());
  var [editingId, setEditingId] = useState("");
  var [busy, setBusy] = useState(false);

  async function reload() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var qs = new URLSearchParams();
      qs.set("limit", "200");
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (statusFilter) qs.set("status", statusFilter);
      if (employeeFilter) qs.set("employee_id", employeeFilter);
      var data = await request("/attendance?" + qs.toString(), null, auth.session);
      setRows(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load attendance");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMissing() {
    if (!auth.session?.access_token) return;
    if (!missingFor || !from || !to) {
      setMissing([]);
      return;
    }
    try {
      var qs = new URLSearchParams({ employee_id: missingFor, from: from, to: to });
      var data = await request("/attendance/missing?" + qs.toString(), null, auth.session);
      setMissing(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
    } catch (err) {
      setMissing([]);
    }
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reload();
      Promise.all([
        request("/lookups/employees", null, auth.session),
        request("/lookups/patients", null, auth.session)
      ])
        .then(function (result) {
          setEmployees(Array.isArray(result[0]) ? result[0] : []);
          setPatients(Array.isArray(result[1]) ? result[1] : []);
        })
        .catch(function () {
          setEmployees([]);
          setPatients([]);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.session, from, to, statusFilter, employeeFilter]
  );

  useEffect(
    function () {
      loadMissing();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [missingFor, from, to, auth.session]
  );

  var stats = useMemo(
    function () {
      var counts = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, LEAVE: 0, HOLIDAY: 0 };
      rows.forEach(function (r) {
        if (counts[r.status] !== undefined) counts[r.status] += 1;
      });
      return counts;
    },
    [rows]
  );

  function buildPayload() {
    var payload = {
      employee_id: form.employee_id,
      status: form.status,
      shift_type: form.shift_type || undefined,
      patient_id: form.patient_id || undefined,
      duty_id: form.duty_id || undefined,
      notes: form.notes || ""
    };
    var noTime = form.status === "ABSENT" || form.status === "LEAVE" || form.status === "HOLIDAY";
    if (!noTime) {
      payload.check_in_at = isoDateTime(form.work_date, form.check_in_time);
      if (form.check_out_time) {
        payload.check_out_at = isoDateTime(form.work_date, form.check_out_time);
      }
    }
    return payload;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.employee_id) {
      setError("Employee is required");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (editingId) {
        await requestWithOfflineFallback(
          "/attendance/" + editingId,
          { method: "PATCH", body: buildPayload() },
          auth.session
        );
        setMessage("Attendance updated");
      } else {
        await requestWithOfflineFallback(
          "/attendance/mark",
          { method: "POST", body: buildPayload() },
          auth.session
        );
        setMessage("Attendance saved");
      }
      setForm(emptyMarkForm());
      setEditingId("");
      await reload();
      await loadMissing();
    } catch (err) {
      setError(err.message || "Could not save attendance");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(row) {
    var date = String(row.check_in_at || "").slice(0, 10) || todayDate();
    var checkIn = String(row.check_in_at || "").slice(11, 16) || "";
    var checkOut = String(row.check_out_at || "").slice(11, 16) || "";
    setForm({
      duty_id: row.duty_id || "",
      employee_id: row.employee_id || "",
      patient_id: row.patient_id || "",
      shift_type: row.shift_type || "DAY",
      work_date: date,
      check_in_time: checkIn,
      check_out_time: checkOut,
      status: row.status || "PRESENT",
      notes: row.notes || row.remarks || ""
    });
    setEditingId(row.id);
  }

  function cancelEdit() {
    setForm(emptyMarkForm());
    setEditingId("");
  }

  async function handleQuickMark(dutyRow, status) {
    setBusy(true);
    setError("");
    try {
      var date = String(dutyRow.start_at || dutyRow.date || todayDate()).slice(0, 10);
      var payload = {
        employee_id: dutyRow.employee_id,
        duty_id: dutyRow.id,
        patient_id: dutyRow.patient_id || undefined,
        shift_type: dutyRow.shift_type || undefined,
        status: status,
        notes: ""
      };
      if (status === "PRESENT" || status === "LATE" || status === "HALF_DAY") {
        payload.check_in_at = dutyRow.start_at || isoDateTime(date, "09:00");
      }
      await requestWithOfflineFallback(
        "/attendance/mark",
        { method: "POST", body: payload },
        auth.session
      );
      setMessage("Marked " + status);
      await reload();
      await loadMissing();
    } catch (err) {
      setError(err.message || "Could not mark attendance");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this attendance row?")) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/attendance/" + id,
        { method: "DELETE" },
        auth.session
      );
      setMessage("Attendance deleted");
      if (editingId === id) cancelEdit();
      await reload();
      await loadMissing();
    } catch (err) {
      setError(err.message || "Could not delete attendance");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="attendance.read">
      <AppShell title="Attendance">
        <div className="page-split">
          <div className="page-grid">
            <ModuleShell
              title={editingId ? "Edit attendance" : "Mark attendance"}
              description="Per-duty or standalone clock-in/out. Status auto-handles timestamp rules."
            >
              <form className="stack" onSubmit={handleSubmit}>
                <div className="grid-2">
                  <div className="field">
                    <label>Employee</label>
                    <select
                      value={form.employee_id}
                      onChange={function (event) {
                        setForm({ ...form, employee_id: event.target.value });
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
                    <label>Patient (optional)</label>
                    <select
                      value={form.patient_id}
                      onChange={function (event) {
                        setForm({ ...form, patient_id: event.target.value });
                      }}
                    >
                      <option value="">No patient</option>
                      {patients.map(function (p) {
                        return (
                          <option key={p.id} value={p.id}>
                            {p.full_name || p.name || p.id}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Status</label>
                    <select
                      value={form.status}
                      onChange={function (event) {
                        setForm({ ...form, status: event.target.value });
                      }}
                    >
                      {ATTENDANCE_STATUSES.map(function (o) {
                        return (
                          <option key={o.value} value={o.value}>
                            {o.label}
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
                        setForm({ ...form, shift_type: event.target.value });
                      }}
                    >
                      {SHIFT_TYPES.map(function (o) {
                        return (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label>Work date</label>
                    <input
                      type="date"
                      value={form.work_date}
                      onChange={function (event) {
                        setForm({ ...form, work_date: event.target.value });
                      }}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Duty id (optional)</label>
                    <input
                      value={form.duty_id}
                      onChange={function (event) {
                        setForm({ ...form, duty_id: event.target.value });
                      }}
                      placeholder="DTY-..."
                    />
                  </div>
                  <div className="field">
                    <label>Check-in</label>
                    <input
                      type="time"
                      value={form.check_in_time}
                      onChange={function (event) {
                        setForm({ ...form, check_in_time: event.target.value });
                      }}
                      disabled={
                        form.status === "ABSENT" || form.status === "LEAVE" || form.status === "HOLIDAY"
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Check-out</label>
                    <input
                      type="time"
                      value={form.check_out_time}
                      onChange={function (event) {
                        setForm({ ...form, check_out_time: event.target.value });
                      }}
                      disabled={
                        form.status === "ABSENT" || form.status === "LEAVE" || form.status === "HOLIDAY"
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <textarea
                    rows="2"
                    value={form.notes}
                    onChange={function (event) {
                      setForm({ ...form, notes: event.target.value });
                    }}
                  />
                </div>
                {error ? <div className="error-text">{error}</div> : null}
                {message ? <div className="success-text">{message}</div> : null}
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy}>
                    {editingId ? "Save changes" : "Mark attendance"}
                  </button>
                  {editingId ? (
                    <button className="button secondary" type="button" onClick={cancelEdit}>
                      Cancel edit
                    </button>
                  ) : null}
                </div>
              </form>
            </ModuleShell>

            <ModuleShell
              title="Missing attendance"
              description="Duties scheduled in the range that don't yet have an attendance row."
            >
              <div className="toolbar">
                <div className="field">
                  <label>Employee</label>
                  <select
                    value={missingFor}
                    onChange={function (event) {
                      setMissingFor(event.target.value);
                    }}
                  >
                    <option value="">Select employee…</option>
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
                  <button className="button secondary" type="button" onClick={loadMissing}>
                    Refresh
                  </button>
                </div>
              </div>
              {!missingFor ? (
                <div className="mini-muted">Pick an employee to see missing attendance.</div>
              ) : !missing.length ? (
                <div className="mini-muted">All duties marked for this employee in the selected window.</div>
              ) : (
                <div className="record-list">
                  {missing.map(function (d) {
                    return (
                      <div key={d.id} className="record-card">
                        <div className="button-row" style={{ justifyContent: "space-between" }}>
                          <div>
                            <h3>{d.service_type || "Duty"}</h3>
                            <div className="record-meta">
                              <span>{formatDate(d.start_at)}</span>
                              <span>{d.shift_type}</span>
                              {d.patient_id ? <span>Patient {d.patient_id}</span> : null}
                            </div>
                          </div>
                          <div className="button-row">
                            <button
                              className="button success"
                              type="button"
                              onClick={function () {
                                handleQuickMark(d, "PRESENT");
                              }}
                              disabled={busy}
                            >
                              Present
                            </button>
                            <button
                              className="button danger"
                              type="button"
                              onClick={function () {
                                handleQuickMark(d, "ABSENT");
                              }}
                              disabled={busy}
                            >
                              Absent
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModuleShell>
          </div>

          <div className="page-grid">
            <ModuleShell title="Attendance log" description="Filter by date range, status, or employee.">
              <div className="toolbar">
                <div className="field">
                  <label>From</label>
                  <input
                    type="date"
                    value={from}
                    onChange={function (event) {
                      setFrom(event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label>To</label>
                  <input
                    type="date"
                    value={to}
                    onChange={function (event) {
                      setTo(event.target.value);
                    }}
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
                    {ATTENDANCE_STATUSES.map(function (o) {
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
                  <button className="button secondary" type="button" onClick={reload}>
                    Refresh
                  </button>
                </div>
              </div>
              <div className="helper-box">
                Present {stats.PRESENT} · Absent {stats.ABSENT} · Late {stats.LATE} · Half {stats.HALF_DAY} ·
                Leave {stats.LEAVE} · Holiday {stats.HOLIDAY}
              </div>
              {!rows.length ? (
                <EmptyState
                  title={loading ? "Loading…" : "No attendance"}
                  description="Mark attendance on the left or via Missing list to fill this log."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Employee</th>
                        <th>Status</th>
                        <th>Shift</th>
                        <th>Check-in</th>
                        <th>Check-out</th>
                        <th>Notes</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(function (r) {
                        var emp = employees.find(function (e) {
                          return e.id === r.employee_id;
                        });
                        return (
                          <tr key={r.id}>
                            <td>{formatDate(r.check_in_at || r.created_at)}</td>
                            <td>{(emp && (emp.full_name || emp.name)) || r.employee_id}</td>
                            <td>
                              <span className={"status " + String(r.status || "").toLowerCase()}>
                                {r.status}
                              </span>
                            </td>
                            <td>{r.shift_type || "-"}</td>
                            <td>{r.check_in_at ? String(r.check_in_at).slice(11, 16) : "-"}</td>
                            <td>{r.check_out_at ? String(r.check_out_at).slice(11, 16) : "-"}</td>
                            <td className="mini-muted">{r.notes || r.remarks || "-"}</td>
                            <td>
                              <div className="button-row">
                                <button
                                  className="button secondary"
                                  type="button"
                                  onClick={function () {
                                    startEdit(r);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="button danger"
                                  type="button"
                                  onClick={function () {
                                    handleDelete(r.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ModuleShell>
          </div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/formatters";

var DUTY_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"];
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function monthKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}

function createInitialForm() {
  var start = new Date();
  start.setHours(8, 0, 0, 0);
  var end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(18, 0, 0, 0);
  return {
    id: "",
    patient_id: "",
    employee_id: "",
    service_name: "Care Taker Services",
    shift_type: "DAY",
    start_at: start.toISOString().slice(0, 16),
    end_at: end.toISOString().slice(0, 16),
    status: "SCHEDULED",
    charge_per_day: "",
    payout_per_day: "",
    payout_term: "Daily",
    extra_partners: [],
    materialize: true,
    notes: "",
    expected_updated_at: ""
  };
}

function toIsoFromLocal(local) {
  if (!local) return "";
  var d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

function daysInMonthGrid(year, monthIndex) {
  var first = new Date(year, monthIndex, 1);
  var startPad = first.getDay();
  var days = new Date(year, monthIndex + 1, 0).getDate();
  var cells = [];
  var i;
  for (i = 0; i < startPad; i++) cells.push(null);
  for (i = 1; i <= days; i++) {
    cells.push(year + "-" + pad2(monthIndex + 1) + "-" + pad2(i));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dutyTouchesDay(row, isoDay) {
  if (!row.start_at || !isoDay) return false;
  var start = String(row.start_at).slice(0, 10);
  var end = String(row.end_at || row.start_at).slice(0, 10);
  return isoDay >= start && isoDay <= end;
}

export default function DutiesPage() {
  var auth = useAuth();
  var [viewMonth, setViewMonth] = useState(monthKey(new Date()));
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [patients, setPatients] = useState([]);
  var [employees, setEmployees] = useState([]);
  var [services, setServices] = useState([]);
  var [filterPatient, setFilterPatient] = useState("");
  var [form, setForm] = useState(createInitialForm());
  var [statusFilter, setStatusFilter] = useState("");
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [cancelDialog, setCancelDialog] = useState(null);
  var [conflictBanner, setConflictBanner] = useState("");
  var [outstanding, setOutstanding] = useState(null);
  var [patientSummary, setPatientSummary] = useState(null);
  var [selectedDay, setSelectedDay] = useState("");

  var ym = useMemo(
    function () {
      var p = viewMonth.split("-");
      return { year: parseInt(p[0], 10), monthIndex: parseInt(p[1], 10) - 1 };
    },
    [viewMonth]
  );

  var calendarCells = useMemo(
    function () {
      return daysInMonthGrid(ym.year, ym.monthIndex);
    },
    [ym]
  );

  async function reload() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var from = viewMonth + "-01T00:00:00.000Z";
      var endDate = new Date(ym.year, ym.monthIndex + 1, 0);
      var to = endDate.toISOString().slice(0, 10) + "T23:59:59.999Z";
      var path = "/duties?limit=500&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
      if (statusFilter) path += "&status=" + encodeURIComponent(statusFilter);
      if (filterPatient) path += "&patient_id=" + encodeURIComponent(filterPatient);
      var data = await request(path, null, auth.session);
      setRows(Array.isArray(data && data.rows) ? data.rows : []);
      setError("");
    } catch (err) {
      setError(err.message || "Unable to load duties");
    } finally {
      setLoading(false);
    }
  }

  async function loadOutstanding(patientId) {
    if (!patientId || !auth.session?.access_token) {
      setOutstanding(null);
      return;
    }
    try {
      var list = await request(
        "/billings?limit=20&patient_id=" + encodeURIComponent(patientId) + "&status=Active",
        null,
        auth.session
      );
      var billRows = Array.isArray(list?.rows) ? list.rows : [];
      var active = billRows.find(function (b) {
        return b.status === "Active";
      });
      if (!active) {
        setOutstanding(null);
        return;
      }
      var bundle = await request("/billings/" + encodeURIComponent(active.id), null, auth.session);
      setOutstanding({
        billing_id: active.id,
        totals: bundle.totals || null
      });
    } catch (_e) {
      setOutstanding(null);
    }
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reload();
    },
    [auth.session, viewMonth, statusFilter, filterPatient]
  );

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      request("/lookups/patients", null, auth.session)
        .then(function (rows) {
          var arr = Array.isArray(rows) ? rows : rows?.rows || rows?.data || [];
          setPatients(arr);
        })
        .catch(function () { setPatients([]); });
      request("/lookups/employees", null, auth.session)
        .then(function (rows) {
          var arr = Array.isArray(rows) ? rows : rows?.rows || rows?.data || [];
          setEmployees(arr);
        })
        .catch(function () { setEmployees([]); });
      request("/lookups/services", null, auth.session)
        .then(function (rows) {
          var arr = Array.isArray(rows) ? rows : rows?.rows || rows?.data || [];
          setServices(arr);
        })
        .catch(function () { setServices([]); });
    },
    [auth.session]
  );

  useEffect(
    function () {
      loadOutstanding(form.patient_id || filterPatient);
    },
    [form.patient_id, filterPatient, auth.session]
  );

  useEffect(
    function () {
      var pid = filterPatient || form.patient_id;
      if (!pid || !auth.session?.access_token) {
        setPatientSummary(null);
        return;
      }
      request("/duties/summary?patient_id=" + encodeURIComponent(pid), null, auth.session)
        .then(function (data) { setPatientSummary(data || null); })
        .catch(function () { setPatientSummary(null); });
    },
    [filterPatient, form.patient_id, auth.session, rows]
  );

  var dayDuties = useMemo(
    function () {
      if (!selectedDay) return [];
      return rows.filter(function (r) {
        return dutyTouchesDay(r, selectedDay);
      });
    },
    [rows, selectedDay]
  );

  function updateField(name, value) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setConflictBanner("");
    setError("");
    setMessage("");
  }

  function editDuty(row) {
    setForm({
      id: row.id,
      patient_id: row.patient_id || "",
      employee_id: row.employee_id || "",
      service_name: row.service_name || row.service_type || "Care Taker Services",
      shift_type: row.shift_type || "DAY",
      start_at: row.start_at ? String(row.start_at).slice(0, 16) : "",
      end_at: row.end_at ? String(row.end_at).slice(0, 16) : "",
      status: row.status || "SCHEDULED",
      charge_per_day: row.charge_per_day != null ? String(row.charge_per_day) : "",
      payout_per_day: row.payout_per_day != null ? String(row.payout_per_day) : "",
      payout_term: row.payout_term || "Daily",
      extra_partners: Array.isArray(row.extra_partners) ? row.extra_partners : [],
      materialize: true,
      notes: row.notes || "",
      expected_updated_at: row.updated_at || ""
    });
    setSelectedDay(String(row.start_at || "").slice(0, 10));
  }

  function addExtraPartner() {
    setForm(function (current) {
      return {
        ...current,
        extra_partners: current.extra_partners.concat([
          { employee_id: "", charge_per_day: "", payout_per_day: "", payout_term: "Daily" }
        ])
      };
    });
  }

  function updateExtraPartner(index, key, value) {
    setForm(function (current) {
      var list = current.extra_partners.slice();
      list[index] = { ...list[index], [key]: value };
      return { ...current, extra_partners: list };
    });
  }

  function removeExtraPartner(index) {
    setForm(function (current) {
      var list = current.extra_partners.slice();
      list.splice(index, 1);
      return { ...current, extra_partners: list };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setConflictBanner("");
    try {
      var payload = {
        patient_id: form.patient_id,
        employee_id: form.employee_id,
        service_name: form.service_name,
        service_type: form.service_name,
        shift_type: form.shift_type,
        start_at: toIsoFromLocal(form.start_at),
        end_at: toIsoFromLocal(form.end_at),
        status: form.status,
        notes: form.notes,
        charge_per_day: Number(form.charge_per_day || 0),
        payout_per_day: Number(form.payout_per_day || 0),
        payout_term: form.payout_term,
        extra_partners: form.extra_partners
          .filter(function (p) {
            return p.employee_id;
          })
          .map(function (p) {
            return {
              employee_id: p.employee_id,
              charge_per_day: Number(p.charge_per_day || form.charge_per_day || 0),
              payout_per_day: Number(p.payout_per_day || form.payout_per_day || 0),
              payout_term: p.payout_term || form.payout_term
            };
          }),
        materialize: form.materialize,
        expected_updated_at: form.expected_updated_at || undefined
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
      await loadOutstanding(form.patient_id);
      resetForm();
      setMessage(form.id ? "Duty updated — diary rows synced when materialize is on" : "Duty created");
    } catch (submitError) {
      var code = submitError.code || "";
      if (code === "CONFLICT" || String(submitError.message || "").toLowerCase().indexOf("stale") >= 0) {
        setConflictBanner(submitError.message || "Record changed elsewhere — reload and retry");
      }
      var conflictDutyId =
        submitError.details && submitError.details.field === "employee_window"
          ? submitError.details.value
          : null;
      if (conflictDutyId) {
        try {
          var conflict = await request(
            "/duties/" + encodeURIComponent(conflictDutyId),
            null,
            auth.session
          );
          var pname = "";
          for (var i = 0; i < patients.length; i++) {
            if (patients[i].id === conflict.patient_id) {
              pname = patients[i].name || patients[i].full_name || "";
              break;
            }
          }
          setConflictBanner(
            (submitError.message || "Staff has overlapping duty") +
              " — " + (pname || conflict.patient_id) +
              " (" + String(conflict.start_at || "").slice(0, 10) +
              " → " + String(conflict.end_at || "").slice(0, 10) + ")"
          );
        } catch (_lookupErr) {
          setConflictBanner(submitError.message || "Staff has overlapping duty");
        }
      }
      setError(submitError.message || "Unable to save duty");
    } finally {
      setBusy(false);
    }
  }

  async function runMaterialize(dutyId) {
    setBusy(true);
    setError("");
    try {
      var data = await request(
        "/duties/" + encodeURIComponent(dutyId) + "/materialize",
        { method: "POST", body: {} },
        auth.session
      );
      setMessage(
        "Materialized " +
          (data.created_svc || 0) +
          " charge(s) and " +
          (data.created_payout || 0) +
          " payout row(s)"
      );
      await reload();
      await loadOutstanding(form.patient_id || filterPatient);
    } catch (err) {
      setError(err.message || "Materialize failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!cancelDialog) return;
    setBusy(true);
    try {
      await request(
        "/duties/" + encodeURIComponent(cancelDialog.id) + "/cancel",
        { method: "POST", body: { reason: cancelDialog.reason || "" } },
        auth.session
      );
      setCancelDialog(null);
      await reload();
      setMessage("Duty cancelled — diary rows removed when safe");
    } catch (err) {
      setError(err.message || "Cancel failed");
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

  function shiftMonth(delta) {
    var d = new Date(ym.year, ym.monthIndex + delta, 1);
    setViewMonth(monthKey(d));
  }

  function dutiesOnDay(isoDay) {
    return rows.filter(function (r) {
      return dutyTouchesDay(r, isoDay);
    });
  }

  return (
    <AuthGuard permission="duties.read">
      <AppShell title="Duty calendar">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit duty assignment" : "New duty assignment"}
            description="Per-day patient charges and partner payouts sync to billing (legacy duty diary parity)"
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
                      var label = p.name || p.full_name || p.id;
                      return (
                        <option key={p.id} value={p.id}>
                          {label + " (" + p.id + ")"}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Primary partner (employee)</label>
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
                  <label>Service</label>
                  <select
                    value={form.service_name}
                    onChange={function (event) {
                      updateField("service_name", event.target.value);
                    }}
                  >
                    <option value="Care Taker Services">Care Taker Services</option>
                    {services.map(function (s, idx) {
                      var name = typeof s === "string" ? s : s.name || s.label || "";
                      if (!name || name === "Care Taker Services") return null;
                      return (
                        <option key={name + idx} value={name}>
                          {name}
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
                  <label>Charge / day (₹ to patient)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.charge_per_day}
                    onChange={function (event) {
                      updateField("charge_per_day", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label>Payout / day (₹ to partner)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.payout_per_day}
                    onChange={function (event) {
                      updateField("payout_per_day", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label>Payout term</label>
                  <input
                    value={form.payout_term}
                    onChange={function (event) {
                      updateField("payout_term", event.target.value);
                    }}
                  />
                </div>
                <div className="field">
                  <label>Start</label>
                  <input
                    type="datetime-local"
                    value={form.start_at}
                    onChange={function (event) {
                      updateField("start_at", event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="field">
                  <label>End</label>
                  <input
                    type="datetime-local"
                    value={form.end_at}
                    onChange={function (event) {
                      updateField("end_at", event.target.value);
                    }}
                    required
                  />
                </div>
              </div>

              <div className="panel detail-card">
                <div className="button-row" style={{ justifyContent: "space-between" }}>
                  <strong>Additional partners (same patient)</strong>
                  <button className="button secondary" type="button" onClick={addExtraPartner}>
                    + Add partner
                  </button>
                </div>
                {!form.extra_partners.length ? (
                  <div className="mini-muted" style={{ marginTop: 8 }}>
                    Optional — assign a second caretaker on the same patient; each gets their own charge and payout row per day.
                  </div>
                ) : (
                  form.extra_partners.map(function (p, idx) {
                    return (
                      <div className="grid-2" key={idx} style={{ marginTop: 12 }}>
                        <div className="field">
                          <label>Partner</label>
                          <select
                            value={p.employee_id}
                            onChange={function (event) {
                              updateExtraPartner(idx, "employee_id", event.target.value);
                            }}
                          >
                            <option value="">Select</option>
                            {employees.map(function (e) {
                              return (
                                <option key={e.id} value={e.id}>
                                  {e.full_name || e.name}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="field">
                          <label>Charge / payout (₹)</label>
                          <div className="grid-2">
                            <input
                              type="number"
                              placeholder="Charge"
                              value={p.charge_per_day}
                              onChange={function (event) {
                                updateExtraPartner(idx, "charge_per_day", event.target.value);
                              }}
                            />
                            <input
                              type="number"
                              placeholder="Payout"
                              value={p.payout_per_day}
                              onChange={function (event) {
                                updateExtraPartner(idx, "payout_per_day", event.target.value);
                              }}
                            />
                          </div>
                        </div>
                        <button
                          className="button danger"
                          type="button"
                          onClick={function () {
                            removeExtraPartner(idx);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.materialize}
                  onChange={function (event) {
                    updateField("materialize", event.target.checked);
                  }}
                />
                Auto-add per-day charges + payouts to active bill (by date range)
              </label>

              <textarea
                rows="2"
                value={form.notes}
                onChange={function (event) {
                  updateField("notes", event.target.value);
                }}
                placeholder="Notes"
              />

              {outstanding && outstanding.totals ? (
                <div className="helper-box">
                  Active bill {outstanding.billing_id}: billed {formatCurrency(outstanding.totals.services)} ·
                  received {formatCurrency(outstanding.totals.receipts)} ·{" "}
                  <strong>outstanding {formatCurrency(outstanding.totals.outstanding)}</strong>
                </div>
              ) : null}

              {conflictBanner ? <div className="error-text">{conflictBanner}</div> : null}
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}

              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving…" : form.id ? "Update duty" : "Save & materialize"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell
            title={"Calendar · " + viewMonth}
            description="Click a day to see assignments. Charges flow to Billing outstanding automatically."
            actions={
              <div className="button-row">
                <button className="button secondary" type="button" onClick={function () { shiftMonth(-1); }}>
                  ←
                </button>
                <button className="button secondary" type="button" onClick={reload}>
                  Refresh
                </button>
                <button className="button secondary" type="button" onClick={function () { shiftMonth(1); }}>
                  →
                </button>
              </div>
            }
          >
            <div className="toolbar grid-2">
              <div className="field">
                <label>Filter patient ({patients.length})</label>
                <select
                  value={filterPatient}
                  onChange={function (event) {
                    setFilterPatient(event.target.value);
                  }}
                >
                  <option value="">All patients</option>
                  {patients.map(function (p) {
                    var label = p.name || p.full_name || p.id;
                    return (
                      <option key={p.id} value={p.id}>
                        {label} ({p.id})
                      </option>
                    );
                  })}
                </select>
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

            {patientSummary ? (
              <div
                className="panel detail-card"
                style={{ marginBottom: 16, background: "#f1f5f9", border: "1px solid #cbd5e1" }}
              >
                <div className="button-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div>
                    <strong>Patient ledger till date</strong>
                    <div className="mini-muted" style={{ marginTop: 4 }}>
                      Across {patientSummary.billings} bill(s), {patientSummary.active_billings} active
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div>Billed {formatCurrency(patientSummary.billed)}</div>
                    <div>Received {formatCurrency(patientSummary.received)}</div>
                    <div style={{ color: patientSummary.outstanding > 0 ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                      Net outstanding {formatCurrency(patientSummary.outstanding)}
                    </div>
                  </div>
                </div>
                {patientSummary.partners && patientSummary.partners.length ? (
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Attendant</th>
                          <th style={{ textAlign: "right" }}>Charges</th>
                          <th style={{ textAlign: "right" }}>Payout earned</th>
                          <th style={{ textAlign: "right" }}>Paid</th>
                          <th style={{ textAlign: "right" }}>Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patientSummary.partners.map(function (p, idx) {
                          return (
                            <tr key={p.partner_id + "_" + idx}>
                              <td>{p.name}</td>
                              <td style={{ textAlign: "right" }}>{formatCurrency(p.charges_total)}</td>
                              <td style={{ textAlign: "right" }}>{formatCurrency(p.payout_total)}</td>
                              <td style={{ textAlign: "right" }}>{formatCurrency(p.paid)}</td>
                              <td
                                style={{
                                  textAlign: "right",
                                  fontWeight: 700,
                                  color: p.due > 0 ? "#b91c1c" : "#15803d"
                                }}
                              >
                                {formatCurrency(p.due)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mini-muted" style={{ marginTop: 12 }}>
                    No partner charges yet — assign a duty to start tracking.
                  </div>
                )}
              </div>
            ) : null}

            <div className="calendar-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {WEEKDAYS.map(function (w) {
                return (
                  <div key={w} className="mini-muted" style={{ textAlign: "center", fontWeight: 600 }}>
                    {w}
                  </div>
                );
              })}
              {calendarCells.map(function (isoDay, idx) {
                if (!isoDay) {
                  return <div key={"pad-" + idx} className="calendar-cell muted" />;
                }
                var dayRows = dutiesOnDay(isoDay);
                var isSelected = selectedDay === isoDay;
                return (
                  <button
                    key={isoDay}
                    type="button"
                    className={"calendar-cell" + (isSelected ? " selected" : "")}
                    style={{
                      minHeight: 72,
                      border: isSelected ? "2px solid #2563eb" : "1px solid #e2e8f0",
                      borderRadius: 6,
                      background: dayRows.length ? "#eff6ff" : "#fff",
                      padding: 6,
                      textAlign: "left",
                      cursor: "pointer"
                    }}
                    onClick={function () {
                      setSelectedDay(isoDay);
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{isoDay.slice(8)}</div>
                    {dayRows.length ? (
                      <div className="mini-muted" style={{ marginTop: 4 }}>
                        {dayRows.length} duty{dayRows.length > 1 ? "ies" : ""}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {selectedDay ? (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ marginBottom: 8 }}>Duties on {formatDate(selectedDay + "T12:00:00Z")}</h3>
                {!dayDuties.length ? (
                  <EmptyState title="No duties this day" description="Create an assignment with start/end covering this date." />
                ) : (
                  <div className="record-list">
                    {dayDuties.map(function (row) {
                      return (
                        <div className="record-card" key={row.id}>
                          <div className="button-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                            <div>
                              <h3>{row.patient_id}</h3>
                              <div className="record-meta">
                                <span>{row.employee_id || "—"}</span>
                                <span>{row.service_name || row.service_type}</span>
                                <span className={"status " + String(row.status || "").toLowerCase()}>{row.status}</span>
                              </div>
                              <div className="mini-muted" style={{ marginTop: 6 }}>
                                ₹{row.charge_per_day || 0}/day charge · ₹{row.payout_per_day || 0}/day payout
                              </div>
                            </div>
                            <div className="button-row">
                              <button className="button secondary" type="button" onClick={function () { editDuty(row); }}>
                                Edit
                              </button>
                              <button
                                className="button secondary"
                                type="button"
                                disabled={busy}
                                onClick={function () { runMaterialize(row.id); }}
                              >
                                Sync diary
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
                              {row.status !== "CANCELLED" && row.status !== "COMPLETED" ? (
                                <button
                                  className="button danger"
                                  type="button"
                                  disabled={busy}
                                  onClick={function () {
                                    setCancelDialog({ id: row.id, reason: "" });
                                  }}
                                >
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
              </div>
            ) : loading ? (
              <div className="mini-muted" style={{ marginTop: 16 }}>Loading…</div>
            ) : null}
          </ModuleShell>
        </div>

        {cancelDialog ? (
          <div className="modal-backdrop" role="presentation">
            <div className="modal-card">
              <h3>Cancel duty</h3>
              <div className="field">
                <label>Reason (optional)</label>
                <input
                  value={cancelDialog.reason}
                  onChange={function (event) {
                    setCancelDialog({ ...cancelDialog, reason: event.target.value });
                  }}
                />
              </div>
              <div className="button-row">
                <button className="button danger" type="button" disabled={busy} onClick={confirmCancel}>
                  Confirm cancel
                </button>
                <button className="button secondary" type="button" onClick={function () { setCancelDialog(null); }}>
                  Back
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </AppShell>
    </AuthGuard>
  );
}

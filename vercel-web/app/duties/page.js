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

var SHIFT_CHIP_STYLES = {
  DAY: { bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  NIGHT: { bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95" },
  "24H": { bg: "#ffedd5", border: "#ea580c", text: "#9a3412" },
  FULL: { bg: "#dcfce7", border: "#16a34a", text: "#14532d" }
};

function shiftChipStyle(shift) {
  return SHIFT_CHIP_STYLES[String(shift || "DAY").toUpperCase()] || SHIFT_CHIP_STYLES.DAY;
}

function shortLabel(name, id) {
  var n = String(name || id || "").trim();
  if (n.length <= 14) return n;
  return n.slice(0, 12) + "…";
}

function dutyMatchesEmployee(row, employeeId) {
  if (!employeeId) return true;
  if (row.employee_id === employeeId) return true;
  var extras = row.extra_partners;
  if (!Array.isArray(extras)) return false;
  return extras.some(function (p) {
    return p && p.employee_id === employeeId;
  });
}

function FinancialBifurcation(props) {
  var totals = props.totals;
  var outstanding = props.outstanding;
  if (!props.patientId && !props.employeeId) return null;
  return (
    <div
      className="helper-box"
      style={{
        gridColumn: "1 / -1",
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        marginTop: 4
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Outstanding & payout</div>
      {props.patientId && totals && totals.patient ? (
        <div>
          <span className="mini-muted">Patient · </span>
          billed {formatCurrency(totals.patient.billed)} · received{" "}
          {formatCurrency(totals.patient.received)} ·{" "}
          <strong style={{ color: totals.patient.outstanding > 0 ? "#b91c1c" : "#15803d" }}>
            outstanding {formatCurrency(totals.patient.outstanding)}
          </strong>
          {totals.patient.sec_dep ? " · sec.dep " + formatCurrency(totals.patient.sec_dep) : ""}
          <span className="mini-muted"> · {totals.patient.bills} bill(s)</span>
        </div>
      ) : props.patientId && outstanding && outstanding.totals ? (
        <div>
          <span className="mini-muted">Active bill {outstanding.billing_id} · </span>
          outstanding {formatCurrency(outstanding.totals.outstanding)}
        </div>
      ) : props.patientId ? (
        <div className="mini-muted">No billing on file for this patient</div>
      ) : null}
      {props.employeeId && totals && totals.partner ? (
        <div style={{ marginTop: totals.patient || outstanding ? 6 : 0 }}>
          <span className="mini-muted">Partner · </span>
          earned {formatCurrency(totals.partner.charged)} · paid{" "}
          {formatCurrency(totals.partner.paid)} ·{" "}
          <strong style={{ color: totals.partner.pending > 0 ? "#b45309" : "#15803d" }}>
            net pending payout {formatCurrency(totals.partner.pending)}
          </strong>
        </div>
      ) : props.employeeId ? (
        <div className="mini-muted" style={{ marginTop: 6 }}>
          Loading partner payout…
        </div>
      ) : null}
    </div>
  );
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
  var [filterEmployee, setFilterEmployee] = useState("");
  var [form, setForm] = useState(createInitialForm());
  var [statusFilter, setStatusFilter] = useState("");
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");
  var [cancelDialog, setCancelDialog] = useState(null);
  var [deleteDialog, setDeleteDialog] = useState(null);
  var [overlapDialog, setOverlapDialog] = useState(null);
  var [conflictBanner, setConflictBanner] = useState("");
  var [outstanding, setOutstanding] = useState(null);
  var [totals, setTotals] = useState(null);
  var [filterTotals, setFilterTotals] = useState(null);
  var [selectedDay, setSelectedDay] = useState("");
  var [previewDialog, setPreviewDialog] = useState(null);

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
      if (filterEmployee) path += "&employee_id=" + encodeURIComponent(filterEmployee);
      var data = await request(path, null, auth.session);
      var list = Array.isArray(data && data.rows) ? data.rows : [];
      if (filterEmployee) {
        list = list.filter(function (r) {
          return dutyMatchesEmployee(r, filterEmployee);
        });
      }
      setRows(list);
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

  async function loadTotals(patientId, employeeId) {
    if (!auth.session?.access_token) {
      return null;
    }
    if (!patientId && !employeeId) {
      return null;
    }
    var qs = [];
    if (patientId) qs.push("patient_id=" + encodeURIComponent(patientId));
    if (employeeId) qs.push("employee_id=" + encodeURIComponent(employeeId));
    try {
      return await request("/duties/totals?" + qs.join("&"), null, auth.session);
    } catch (_e) {
      return null;
    }
  }

  async function refreshFormTotals() {
    var data = await loadTotals(form.patient_id, form.employee_id);
    setTotals(data || null);
  }

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      reload();
    },
    [auth.session, viewMonth, statusFilter, filterPatient, filterEmployee]
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
      if (!form.patient_id && !form.employee_id) {
        setTotals(null);
        return;
      }
      loadTotals(form.patient_id, form.employee_id).then(function (data) {
        setTotals(data || null);
      });
    },
    [form.patient_id, form.employee_id, auth.session]
  );

  useEffect(
    function () {
      if (!filterPatient && !filterEmployee) {
        setFilterTotals(null);
        return;
      }
      loadTotals(filterPatient, filterEmployee).then(function (data) {
        setFilterTotals(data);
      });
    },
    [filterPatient, filterEmployee, auth.session]
  );

  var patientNameById = useMemo(
    function () {
      var map = {};
      patients.forEach(function (p) {
        map[p.id] = p.name || p.full_name || p.id;
      });
      return map;
    },
    [patients]
  );

  var employeeNameById = useMemo(
    function () {
      var map = {};
      employees.forEach(function (e) {
        map[e.id] = e.full_name || e.name || e.id;
      });
      return map;
    },
    [employees]
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

  function buildPayload(confirmOverlap) {
    return {
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
      expected_updated_at: form.expected_updated_at || undefined,
      confirm_staff_overlap: !!confirmOverlap
    };
  }

  async function submitPayload(payload) {
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
    await refreshFormTotals();
    resetForm();
    setMessage(form.id ? "Duty updated — diary rows synced when materialize is on" : "Duty created");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setConflictBanner("");
    try {
      await submitPayload(buildPayload(false));
    } catch (submitError) {
      var msg = String(submitError.message || "").toLowerCase();
      var code = submitError.code || "";
      if (msg.indexOf("overlapping") >= 0 || code === "DUPLICATE") {
        setOverlapDialog({ message: submitError.message || "Staff has another overlapping duty" });
      } else if (code === "CONFLICT" || msg.indexOf("stale") >= 0) {
        setConflictBanner(submitError.message || "Record changed elsewhere — reload and retry");
        setError(submitError.message || "Unable to save duty");
      } else {
        setError(submitError.message || "Unable to save duty");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmOverlapAndSave() {
    setBusy(true);
    setError("");
    try {
      await submitPayload(buildPayload(true));
      setOverlapDialog(null);
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runMaterialize(dutyId, skipPreview) {
    if (!skipPreview) {
      setBusy(true);
      setError("");
      try {
        var preview = await request(
          "/duties/" + encodeURIComponent(dutyId) + "/materialize",
          { method: "POST", body: { dry_run: true } },
          auth.session
        );
        setPreviewDialog({ dutyId: dutyId, data: preview });
      } catch (err) {
        setError(err.message || "Preview failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError("");
    try {
      var data = await request(
        "/duties/" + encodeURIComponent(dutyId) + "/materialize",
        { method: "POST", body: {} },
        auth.session
      );
      setPreviewDialog(null);
      setMessage(
        "Diary synced: +" +
          (data.created_svc || 0) +
          "/" +
          (data.created_payout || 0) +
          " created, " +
          (data.updated_svc || 0) +
          "/" +
          (data.updated_payout || 0) +
          " updated, " +
          (data.deleted_svc || 0) +
          "/" +
          (data.deleted_payout || 0) +
          " removed"
      );
      await reload();
      await loadOutstanding(form.patient_id || filterPatient);
      await refreshFormTotals();
      if (filterPatient || filterEmployee) {
        var ft = await loadTotals(filterPatient, filterEmployee);
        setFilterTotals(ft || null);
      }
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

  async function confirmHardDelete() {
    if (!deleteDialog) return;
    setBusy(true);
    setError("");
    try {
      await request(
        "/duties/" + encodeURIComponent(deleteDialog.id) + "?hard=1",
        { method: "DELETE" },
        auth.session
      );
      setDeleteDialog(null);
      await reload();
      setMessage("Duty deleted — diary rows removed");
    } catch (err) {
      setError(err.message || "Delete failed");
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
              </div>

              <FinancialBifurcation
                patientId={form.patient_id}
                employeeId={form.employee_id}
                totals={totals}
                outstanding={outstanding}
              />

              <div className="grid-2">
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
            <div className="toolbar" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
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
                <label>Filter caretaker ({employees.length})</label>
                <select
                  value={filterEmployee}
                  onChange={function (event) {
                    setFilterEmployee(event.target.value);
                  }}
                >
                  <option value="">All staff</option>
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

            {filterPatient || filterEmployee ? (
              <FinancialBifurcation
                patientId={filterPatient}
                employeeId={filterEmployee}
                totals={filterTotals}
                outstanding={null}
              />
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
                      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                        {dayRows.slice(0, 3).map(function (row) {
                          var chip = shiftChipStyle(row.shift_type);
                          return (
                            <span
                              key={row.id}
                              style={{
                                fontSize: 10,
                                lineHeight: 1.2,
                                padding: "2px 4px",
                                borderRadius: 4,
                                background: chip.bg,
                                border: "1px solid " + chip.border,
                                color: chip.text,
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                textOverflow: "ellipsis"
                              }}
                              title={
                                (employeeNameById[row.employee_id] || row.employee_id || "—") +
                                " · " +
                                (patientNameById[row.patient_id] || row.patient_id) +
                                " · " +
                                (row.shift_type || "DAY")
                              }
                            >
                              {shortLabel(employeeNameById[row.employee_id], row.employee_id || "—")}{" "}
                              <span style={{ opacity: 0.85 }}>{row.shift_type}</span>
                            </span>
                          );
                        })}
                        {dayRows.length > 3 ? (
                          <span className="mini-muted" style={{ fontSize: 10 }}>
                            +{dayRows.length - 3} more
                          </span>
                        ) : null}
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
                              <h3>{patientNameById[row.patient_id] || row.patient_id}</h3>
                              <div className="record-meta">
                                <span>{employeeNameById[row.employee_id] || row.employee_id || "—"}</span>
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
                                onClick={function () { runMaterialize(row.id, false); }}
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
                              <button
                                className="button danger ghost"
                                type="button"
                                disabled={busy}
                                style={{ background: "transparent", color: "#b91c1c", borderColor: "#fecaca" }}
                                onClick={function () {
                                  setDeleteDialog({
                                    id: row.id,
                                    patient: patientNameById[row.patient_id] || row.patient_id,
                                    employee: employeeNameById[row.employee_id] || row.employee_id || "—",
                                    range: String(row.start_at || "").slice(0, 10) +
                                      " → " + String(row.end_at || row.start_at || "").slice(0, 10)
                                  });
                                }}
                              >
                                Delete
                              </button>
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

        {previewDialog && previewDialog.data ? (
          <div className="modal-backdrop" role="presentation">
            <div className="modal-card" style={{ maxWidth: 720, width: "95%" }}>
              <h3>Sync diary preview</h3>
              <p className="mini-muted">
                Create {previewDialog.data.would_create_svc || 0} / update{" "}
                {previewDialog.data.would_update_svc || 0} patient charge(s) · create{" "}
                {previewDialog.data.would_create_payout || 0} / update{" "}
                {previewDialog.data.would_update_payout || 0} payout(s) · delete{" "}
                {(previewDialog.data.would_delete_svc || 0) +
                  (previewDialog.data.would_delete_payout || 0)}{" "}
                orphan row(s).
              </p>
              <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto", marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Partner</th>
                      <th>Charge</th>
                      <th>Payout</th>
                      <th>Patient svc</th>
                      <th>Partner pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewDialog.data.preview || []).slice(0, 60).map(function (line, idx) {
                      return (
                        <tr key={idx}>
                          <td>{line.date}</td>
                          <td>{line.employee_name}</td>
                          <td>{formatCurrency(line.charge)}</td>
                          <td>{formatCurrency(line.payout)}</td>
                          <td>{line.svc_action}</td>
                          <td>{line.payout_action}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(previewDialog.data.preview || []).length > 60 ? (
                <p className="mini-muted">Showing first 60 of {(previewDialog.data.preview || []).length} rows.</p>
              ) : null}
              <div className="button-row" style={{ marginTop: 16 }}>
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={function () { runMaterialize(previewDialog.dutyId, true); }}
                >
                  Confirm sync
                </button>
                <button className="button secondary" type="button" onClick={function () { setPreviewDialog(null); }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {overlapDialog ? (
          <div className="modal-backdrop" role="presentation">
            <div className="modal-card">
              <h3>Staff has overlapping duty</h3>
              <p>{overlapDialog.message}</p>
              <p className="mini-muted">
                Legacy CRM allowed the same staff to be on relief / shared shifts. Confirm to save anyway.
              </p>
              <div className="button-row">
                <button className="button primary" type="button" disabled={busy} onClick={confirmOverlapAndSave}>
                  Save anyway
                </button>
                <button className="button secondary" type="button" onClick={function () { setOverlapDialog(null); }}>
                  Back
                </button>
              </div>
            </div>
          </div>
        ) : null}

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

        {deleteDialog ? (
          <div className="modal-backdrop" role="presentation">
            <div className="modal-card">
              <h3>Delete duty permanently?</h3>
              <p>
                <strong>{deleteDialog.patient}</strong> · {deleteDialog.employee}
              </p>
              <p className="mini-muted">{deleteDialog.range}</p>
              <p className="mini-muted">
                This removes the duty row <strong>and all of its diary charges &amp; payouts</strong>.
                Will fail if receipts already exist on the bill (cancel instead).
              </p>
              <div className="button-row">
                <button className="button danger" type="button" disabled={busy} onClick={confirmHardDelete}>
                  Delete forever
                </button>
                <button className="button secondary" type="button" onClick={function () { setDeleteDialog(null); }}>
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

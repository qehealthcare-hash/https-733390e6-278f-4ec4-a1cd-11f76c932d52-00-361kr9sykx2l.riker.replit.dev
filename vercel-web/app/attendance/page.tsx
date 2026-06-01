"use client";

/**
 * Attendance board + log (M8 Pass D).
 * Date helpers: `@/lib/attendanceUi`. All writes via `/api/v1/attendance/*`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, SuccessBanner } from "@/components/ui/status-banner";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { formatDate } from "@/lib/formatters";
import { crmTodayIso } from "@/src/utils/crmToday";
import {
  ATTENDANCE_DELETE_ROLES,
  ATTENDANCE_WRITE_ROLES
} from "@/business/rbac";
import {
  ATTENDANCE_SHIFT_OPTIONS,
  ATTENDANCE_STATUS_OPTIONS,
  DERIVED_STATUS_STYLES,
  emptyMarkForm,
  istDayKey,
  isoDateTime,
  startOfWeek,
  todayDate
} from "@/lib/attendanceUi";

function roleInList(role, list) {
  var normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

export default function AttendancePage() {
  var auth = useAuth();
  var canWrite = roleInList(auth.profile?.role, ATTENDANCE_WRITE_ROLES);
  var canDelete = roleInList(auth.profile?.role, ATTENDANCE_DELETE_ROLES);
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [employees, setEmployees] = useState([]);
  var [patients, setPatients] = useState([]);
  var [error, setErrorState] = useState("");
  var [message, setMessageState] = useState("");
  // Mirror local banner state into the centralized toast layer so users see
  // success/error feedback even when the inline banner is offscreen.
  var toast = useToast();
  var setError = useCallback(function (msg) {
    var text = String(msg || "");
    setErrorState(text);
    if (text) toast.error(text);
  }, [toast]);
  var setMessage = useCallback(function (msg) {
    var text = String(msg || "");
    setMessageState(text);
    if (text) toast.success(text);
  }, [toast]);
  var [from, setFrom] = useState(startOfWeek());
  var [to, setTo] = useState(todayDate());
  var [statusFilter, setStatusFilter] = useState("");
  var [employeeFilter, setEmployeeFilter] = useState("");
  var [logSummary, setLogSummary] = useState(null);
  var [missing, setMissing] = useState([]);
  var [missingFor, setMissingFor] = useState("");
  var [form, setForm] = useState(emptyMarkForm());
  var [editingId, setEditingId] = useState("");
  var [busy, setBusy] = useState(false);

  // Day board — "all staff attendance for one day" synchronised with the
  // duty calendar. Defaults to today (IST). One PATCH/POST mark from this
  // panel both writes attendance and flips the underlying SCHEDULED duty to
  // IN_PROGRESS.
  var [boardDate, setBoardDate] = useState(crmTodayIso());
  var [boardData, setBoardData] = useState(null);
  var [boardLoading, setBoardLoading] = useState(false);
  var [boardEmpFilter, setBoardEmpFilter] = useState("");
  var [boardPatientFilter, setBoardPatientFilter] = useState("");
  var [boardError, setBoardError] = useState("");
  var [boardBusyKey, setBoardBusyKey] = useState("");

  var loadBoard = useCallback(
    async function () {
      if (!auth.session?.access_token) return;
      setBoardLoading(true);
      setBoardError("");
      try {
        var qs = new URLSearchParams();
        if (boardDate) qs.set("date", boardDate);
        if (boardEmpFilter) qs.set("employee_id", boardEmpFilter);
        if (boardPatientFilter) qs.set("patient_id", boardPatientFilter);
        var data = await request("/attendance/day?" + qs.toString(), null, auth.session);
        setBoardData(data || null);
      } catch (err) {
        setBoardData(null);
        setBoardError(err.message || "Could not load day board");
      } finally {
        setBoardLoading(false);
      }
    },
    [auth.session, boardDate, boardEmpFilter, boardPatientFilter]
  );

  useEffect(
    function () {
      loadBoard();
    },
    [loadBoard]
  );

  // Refresh the day board whenever a duty/attendance row changes elsewhere
  // (e.g. operator hits check-in from the Duty Calendar). Same realtime
  // channel as the calendar, scoped to a single subscription.
  useEffect(
    function () {
      if (!auth.session?.access_token || !auth.supabase) return undefined;
      var debounce = null;
      function scheduleRefresh() {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(function () {
          debounce = null;
          loadBoard();
        }, 300);
      }
      var channel = auth.supabase.channel("crm-attendance_day_board");
      ["hh_attendance", "hh_duties"].forEach(function (table) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: table },
          scheduleRefresh
        );
      });
      channel.subscribe();
      return function cleanup() {
        if (debounce) clearTimeout(debounce);
        auth.supabase.removeChannel(channel);
      };
      // P1-27: depend on the access_token, not the full session object;
      // see app/duties/page.js for the full story.
    },
    [auth.session?.access_token, auth.supabase, loadBoard]
  );

  async function quickMarkBoard(row, status) {
    if (!canWrite) return;
    if (!auth.session?.access_token) return;
    setBoardBusyKey(row.key);
    setBoardError("");
    try {
      var payload = {
        date: boardData?.date || boardDate,
        employee_id: row.employee_id,
        duty_id: row.duty_id || undefined,
        patient_id: row.patient_id || undefined,
        shift_type: row.shift_type || undefined,
        status: status,
        sync_duty: true
      };
      await requestWithOfflineFallback(
        "/attendance/day/mark",
        { method: "POST", body: payload },
        auth.session
      );
      setMessage("Marked " + status);
      await loadBoard();
      // Existing log/stats also depend on attendance — refresh and await
      // so a fast double-click cannot interleave with stale rows.
      await reload();
    } catch (err) {
      var msg = err.message || "Could not mark";
      setBoardError(msg);
      toast.error(msg);
    } finally {
      setBoardBusyKey("");
    }
  }

  async function reload() {
    if (!auth.session?.access_token) return;
    setLoading(true);
    try {
      var qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (statusFilter) qs.set("status", statusFilter);
      if (employeeFilter) qs.set("employee_id", employeeFilter);
      var data = await request("/attendance/range?" + qs.toString(), null, auth.session);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setLogSummary(data?.summary || null);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load attendance");
      setRows([]);
      setLogSummary(null);
    } finally {
      setLoading(false);
    }
  }

  function downloadLogPdf() {
    if (!rows.length) return;
    var employeeLabel = "All staff";
    if (employeeFilter) {
      var emp = employees.find(function (e) {
        return e.id === employeeFilter;
      });
      employeeLabel = (emp && (emp.full_name || emp.name)) || employeeFilter;
    }
    var summary = logSummary || stats;
    var totalHours = Number(summary.total_hours || summary.TOTAL_HOURS || 0);
    var totalPayout = Number(summary.total_payout || summary.TOTAL_PAYOUT || 0);
    var counts = {
      Present:
        (summary.present || 0) +
        (summary.in_progress || 0) +
        (summary.completed || 0) +
        (summary.PRESENT || 0),
      Absent: summary.absent || summary.ABSENT || 0,
      Late: summary.late || summary.LATE || 0,
      "Half day": summary.half_day || summary.HALF_DAY || 0,
      Leave: summary.leave || summary.LEAVE || 0,
      Holiday: summary.holiday || summary.HOLIDAY || 0,
      Scheduled: summary.scheduled || summary.SCHEDULED || 0
    };
    function escapeHtml(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    var rowsHtml = rows
      .map(function (r, idx) {
        return (
          "<tr>" +
          "<td>" + (idx + 1) + "</td>" +
          "<td>" + escapeHtml(r.date || (r.check_in_at ? String(r.check_in_at).slice(0, 10) : "")) + "</td>" +
          "<td>" + escapeHtml(r.employee_name || r.employee_id || "") +
          (r.is_extra_partner ? " <span class='muted'>(relief)</span>" : "") + "</td>" +
          "<td>" + escapeHtml(r.patient_name || "—") + "</td>" +
          "<td>" + escapeHtml(r.shift_type || "—") + "</td>" +
          "<td><span class='pill pill-" +
          escapeHtml(String(r.derived_status || r.status || "").toLowerCase()) +
          "'>" +
          escapeHtml(r.derived_status || r.status || "—") +
          "</span></td>" +
          "<td>" + (r.check_in_at ? escapeHtml(String(r.check_in_at).slice(11, 16)) : "—") + "</td>" +
          "<td>" + (r.check_out_at ? escapeHtml(String(r.check_out_at).slice(11, 16)) : "—") + "</td>" +
          "<td class='num'>" + Number(r.hours || 0).toFixed(2) + "</td>" +
          "<td class='num'>" +
          (Number(r.payout || 0) > 0
            ? "₹" + Number(r.payout).toLocaleString("en-IN", { maximumFractionDigits: 2 })
            : "—") +
          "</td>" +
          "<td>" + escapeHtml(r.notes || r.remarks || "") + "</td>" +
          "</tr>"
        );
      })
      .join("");
    var summaryRows = Object.entries(counts)
      .map(function (entry) {
        return "<span><strong>" + entry[0] + ":</strong> " + entry[1] + "</span>";
      })
      .join(" · ");
    var html =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<title>Attendance — " + escapeHtml(employeeLabel) + " (" + escapeHtml(from) + " to " + escapeHtml(to) + ")</title>" +
      "<style>" +
      "*{box-sizing:border-box;}" +
      "body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px;color:#0f172a;}" +
      "h1{margin:0 0 4px;font-size:20px;}" +
      "h2{margin:0 0 16px;font-size:14px;font-weight:500;color:#475569;}" +
      ".meta{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:12px;color:#334155;margin-bottom:12px;}" +
      ".summary{background:#f1f5f9;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:6px 12px;}" +
      "table{width:100%;border-collapse:collapse;font-size:11px;}" +
      "thead th{background:#0f172a;color:#fff;text-align:left;padding:6px 8px;font-weight:600;}" +
      "tbody td{padding:6px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;}" +
      "tbody tr:nth-child(even){background:#f8fafc;}" +
      ".num{text-align:right;font-variant-numeric:tabular-nums;}" +
      ".muted{color:#64748b;font-size:10px;}" +
      ".pill{display:inline-block;padding:2px 6px;border-radius:999px;font-size:10px;font-weight:600;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;}" +
      ".pill-present,.pill-completed,.pill-in_progress{background:#dcfce7;border-color:#16a34a;color:#166534;}" +
      ".pill-late,.pill-half_day{background:#fef3c7;border-color:#d97706;color:#92400e;}" +
      ".pill-absent{background:#fee2e2;border-color:#dc2626;color:#991b1b;}" +
      ".pill-leave{background:#ede9fe;border-color:#7c3aed;color:#5b21b6;}" +
      ".pill-holiday{background:#cffafe;border-color:#0891b2;color:#155e75;}" +
      ".pill-scheduled,.pill-unmarked{background:#f1f5f9;border-color:#64748b;color:#1f2937;}" +
      ".totals{margin-top:16px;padding-top:12px;border-top:2px solid #0f172a;display:flex;flex-wrap:wrap;gap:16px;font-size:13px;font-weight:600;}" +
      ".sign{margin-top:32px;display:flex;justify-content:space-between;font-size:12px;color:#334155;}" +
      ".sign div{flex:1;text-align:center;padding-top:36px;border-top:1px dashed #94a3b8;margin:0 12px;}" +
      "@media print{body{margin:12mm;} thead th{background:#0f172a !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}" +
      "</style></head><body>" +
      "<h1>Attendance — Salary reference</h1>" +
      "<h2>" + escapeHtml(employeeLabel) + " · " + escapeHtml(from) + " → " + escapeHtml(to) + "</h2>" +
      "<div class='meta'>" +
      "<span>Generated " + escapeHtml(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })) + " IST</span>" +
      "<span>Rows: " + rows.length + "</span>" +
      (statusFilter ? "<span>Status filter: " + escapeHtml(statusFilter) + "</span>" : "") +
      "</div>" +
      "<div class='summary'>" + summaryRows + "</div>" +
      "<table><thead><tr>" +
      "<th>#</th><th>Date</th><th>Employee</th><th>Patient</th><th>Shift</th><th>Status</th>" +
      "<th>In</th><th>Out</th><th>Hours</th><th>Payout</th><th>Notes</th>" +
      "</tr></thead><tbody>" + rowsHtml + "</tbody></table>" +
      "<div class='totals'>" +
      "<span>Total hours: " + totalHours.toFixed(2) + "</span>" +
      "<span>Total payout: ₹" + totalPayout.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + "</span>" +
      "</div>" +
      "<div class='sign'>" +
      "<div>Prepared by</div>" +
      "<div>Verified by</div>" +
      "<div>Approved by</div>" +
      "</div>" +
      "<script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>" +
      "</body></html>";
    var win = window.open("", "_blank");
    if (!win) {
      setError("Pop-up blocked — allow pop-ups to download the PDF");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
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
    [auth.session?.access_token, from, to, statusFilter, employeeFilter]
  );

  useEffect(
    function () {
      loadMissing();
    },
    [missingFor, from, to, auth.session?.access_token]
  );

  var stats = useMemo(
    function () {
      if (logSummary) {
        return {
          PRESENT: (logSummary.present || 0) + (logSummary.in_progress || 0) + (logSummary.completed || 0),
          ABSENT: logSummary.absent || 0,
          LATE: logSummary.late || 0,
          HALF_DAY: logSummary.half_day || 0,
          LEAVE: logSummary.leave || 0,
          HOLIDAY: logSummary.holiday || 0,
          SCHEDULED: logSummary.scheduled || 0,
          TOTAL_HOURS: logSummary.total_hours || 0,
          TOTAL_CHARGE: logSummary.total_charge || 0,
          TOTAL_PAYOUT: logSummary.total_payout || 0
        };
      }
      var counts = {
        PRESENT: 0,
        ABSENT: 0,
        LATE: 0,
        HALF_DAY: 0,
        LEAVE: 0,
        HOLIDAY: 0,
        SCHEDULED: 0,
        TOTAL_HOURS: 0,
        TOTAL_CHARGE: 0,
        TOTAL_PAYOUT: 0
      };
      rows.forEach(function (r) {
        var s = String(r.derived_status || r.status || "").toUpperCase();
        if (counts[s] !== undefined) counts[s] += 1;
        counts.TOTAL_HOURS += Number(r.hours || 0);
        counts.TOTAL_CHARGE += Number(r.charge || 0);
        counts.TOTAL_PAYOUT += Number(r.payout || 0);
      });
      return counts;
    },
    [rows, logSummary]
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
    if (!canWrite) {
      setError("You do not have permission to mark attendance");
      return;
    }
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
    if (!canWrite) return;
    if (!row.updated_at) {
      setMessage(
        "Legacy row without server updated_at — save carefully; another user may have edited it."
      );
    }
    // Prefer the persisted IST work_date when available, otherwise derive
    // the IST date from the check-in timestamp. UTC-slicing check_in_at
    // misreports the calendar day for any check-in after 18:30 UTC.
    var date =
      String(row.work_date || "").slice(0, 10) ||
      istDayKey(row.check_in_at) ||
      todayDate();
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
    if (!canWrite) return;
    setBusy(true);
    setError("");
    try {
      // IST date for the duty (or today). Stripping the UTC ISO with
      // slice(0,10) misattributes late-evening duties to the prior day.
      var date = istDayKey(dutyRow.start_at) || String(dutyRow.date || "").slice(0, 10) || todayDate();
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
    if (!canDelete) return;
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

  var boardSummary = boardData?.summary || {};
  var boardRows = Array.isArray(boardData?.rows) ? boardData.rows : [];

  return (
    <AuthGuard permission="attendance.read">
      <AppShell title="Attendance">
        <ModuleShell
          title={"All staff attendance — " + (boardData?.date || boardDate)}
          description="Synchronised with the duty calendar. Mark Present / Absent / Late and the underlying duty status updates automatically."
        >
          {!canWrite ? (
            <div className="helper-box" style={{ marginBottom: 12 }}>
              You have read-only access. Only Admin, Manager, Staff, Nurse, and Supervisor can mark
              attendance.
            </div>
          ) : null}
          <div className="toolbar" style={{ flexWrap: "wrap" }}>
            <div className="field">
              <label htmlFor="attendance-date-1">Date</label>
              <input id="attendance-date-1"
                type="date"
                value={boardDate}
                onChange={function (event) {
                  setBoardDate(event.target.value || crmTodayIso());
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="attendance-employee-2">Employee</label>
              <select id="attendance-employee-2"
                value={boardEmpFilter}
                onChange={function (event) {
                  setBoardEmpFilter(event.target.value);
                }}
              >
                <option value="">All staff</option>
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
              <label htmlFor="attendance-patient-3">Patient</label>
              <select id="attendance-patient-3"
                value={boardPatientFilter}
                onChange={function (event) {
                  setBoardPatientFilter(event.target.value);
                }}
              >
                <option value="">All patients</option>
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
              <span aria-hidden="true">&nbsp;</span>
              <button
                className="button secondary"
                type="button"
                onClick={function () {
                  setBoardDate(crmTodayIso());
                }}
              >
                Today
              </button>
            </div>
            <div className="field">
              <span aria-hidden="true">&nbsp;</span>
              <button className="button secondary" type="button" onClick={loadBoard} disabled={boardLoading}>
                {boardLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="helper-box" style={{ flexWrap: "wrap" }}>
            <strong>Total {boardSummary.total || 0}</strong>
            <span style={{ marginLeft: 12 }}>Unmarked {boardSummary.unmarked || 0}</span>
            <span style={{ marginLeft: 12 }}>Present {boardSummary.present || 0}</span>
            <span style={{ marginLeft: 12 }}>In-progress {boardSummary.in_progress || 0}</span>
            <span style={{ marginLeft: 12 }}>Completed {boardSummary.completed || 0}</span>
            <span style={{ marginLeft: 12 }}>Late {boardSummary.late || 0}</span>
            <span style={{ marginLeft: 12 }}>Half {boardSummary.half_day || 0}</span>
            <span style={{ marginLeft: 12 }}>Absent {boardSummary.absent || 0}</span>
            <span style={{ marginLeft: 12 }}>Leave {boardSummary.leave || 0}</span>
            <span style={{ marginLeft: 12 }}>Holiday {boardSummary.holiday || 0}</span>
          </div>

          <ErrorBanner message={boardError} />

          {!boardLoading && boardRows.length === 0 ? (
            <EmptyState
              title="No staff scheduled"
              description="No duties or attendance found for this date. Try another date or remove filters."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Patient</th>
                    <th>Shift</th>
                    <th>Status</th>
                    <th>Times</th>
                    <th>Notes</th>
                    <th style={{ minWidth: 280 }}>Quick mark</th>
                  </tr>
                </thead>
                <tbody>
                  {boardRows.map(function (row) {
                    var style =
                      DERIVED_STATUS_STYLES[row.derived_status] || DERIVED_STATUS_STYLES.UNMARKED;
                    var busyKey = boardBusyKey === row.key;
                    var checkIn = row.check_in_at ? String(row.check_in_at).slice(11, 16) : "";
                    var checkOut = row.check_out_at ? String(row.check_out_at).slice(11, 16) : "";
                    var times = "";
                    if (checkIn && checkOut) times = checkIn + " → " + checkOut;
                    else if (checkIn) times = "in " + checkIn;
                    else times = "—";
                    return (
                      <tr key={row.key}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.employee_name}</div>
                          <div className="mini-muted" style={{ fontSize: 11 }}>
                            {row.employee_id}
                            {row.is_extra_partner ? " · relief" : ""}
                          </div>
                        </td>
                        <td>
                          <div>{row.patient_name}</div>
                          {row.patient_id ? (
                            <div className="mini-muted" style={{ fontSize: 11 }}>
                              {row.patient_id}
                            </div>
                          ) : null}
                        </td>
                        <td>{row.shift_type || "—"}</td>
                        <td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: style.bg,
                              border: "1px solid " + style.border,
                              color: style.text,
                              fontSize: 11,
                              fontWeight: 600
                            }}
                          >
                            {row.derived_status}
                          </span>
                        </td>
                        <td className="mini-muted" style={{ fontSize: 12 }}>
                          {times}
                          {row.hours ? " · " + row.hours + "h" : ""}
                        </td>
                        <td className="mini-muted" style={{ fontSize: 12 }}>
                          {row.notes || ""}
                        </td>
                        <td>
                          <div className="button-row" style={{ flexWrap: "wrap", gap: 4 }}>
                            <button
                              className="button success"
                              type="button"
                              disabled={
                                !canWrite ||
                                busyKey ||
                                row.derived_status === "PRESENT" ||
                                row.derived_status === "IN_PROGRESS" ||
                                row.derived_status === "COMPLETED"
                              }
                              onClick={function () {
                                quickMarkBoard(row, "PRESENT");
                              }}
                              style={{ padding: "4px 10px", fontSize: 12 }}
                            >
                              Present
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={!canWrite || busyKey || row.derived_status === "LATE"}
                              onClick={function () {
                                quickMarkBoard(row, "LATE");
                              }}
                              style={{ padding: "4px 10px", fontSize: 12 }}
                            >
                              Late
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={!canWrite || busyKey || row.derived_status === "HALF_DAY"}
                              onClick={function () {
                                quickMarkBoard(row, "HALF_DAY");
                              }}
                              style={{ padding: "4px 10px", fontSize: 12 }}
                            >
                              Half
                            </button>
                            <button
                              className="button danger"
                              type="button"
                              disabled={!canWrite || busyKey || row.derived_status === "ABSENT"}
                              onClick={function () {
                                quickMarkBoard(row, "ABSENT");
                              }}
                              style={{ padding: "4px 10px", fontSize: 12 }}
                            >
                              Absent
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={!canWrite || busyKey}
                              onClick={function () {
                                quickMarkBoard(row, "LEAVE");
                              }}
                              style={{ padding: "4px 10px", fontSize: 12 }}
                            >
                              Leave
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

        <ModuleShell title="Attendance log" description="Historical log — filter by date range, status, or employee.">
          <div className="toolbar" style={{ flexWrap: "wrap" }}>
            <div className="field">
              <label htmlFor="attendance-from-6">From</label>
              <input id="attendance-from-6"
                type="date"
                value={from}
                onChange={function (event) {
                  setFrom(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="attendance-to-7">To</label>
              <input id="attendance-to-7"
                type="date"
                value={to}
                onChange={function (event) {
                  setTo(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="attendance-status-8">Status</label>
              <select id="attendance-status-8"
                value={statusFilter}
                onChange={function (event) {
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="">All</option>
                {ATTENDANCE_STATUS_OPTIONS.map(function (o) {
                  return (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="field">
              <label htmlFor="attendance-employee-9">Employee</label>
              <select id="attendance-employee-9"
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
              <span aria-hidden="true">&nbsp;</span>
              <button className="button secondary" type="button" onClick={reload}>
                Refresh
              </button>
            </div>
            <div className="field">
              <span aria-hidden="true">&nbsp;</span>
              <button
                className="button primary"
                type="button"
                onClick={downloadLogPdf}
                disabled={!rows.length}
                title={!rows.length ? "Load some rows first" : "Open a printable salary-reference report"}
              >
                Download PDF
              </button>
            </div>
          </div>
          <div className="helper-box">
            Present {stats.PRESENT} · Absent {stats.ABSENT} · Late {stats.LATE} · Half {stats.HALF_DAY} ·
            Leave {stats.LEAVE} · Holiday {stats.HOLIDAY} · Scheduled {stats.SCHEDULED || 0}
            <br />
            Hours {Number(stats.TOTAL_HOURS || 0).toFixed(2)} · Charge ₹
            {Number(stats.TOTAL_CHARGE || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ·
            Payout ₹
            {Number(stats.TOTAL_PAYOUT || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </div>
          {!rows.length ? (
            <EmptyState
              title={loading ? "Loading…" : "No attendance"}
              description="Adjust filters above, or mark attendance from the all-staff board / manual form."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>Patient</th>
                    <th>Shift</th>
                    <th>Status</th>
                    <th>Check-in</th>
                    <th>Check-out</th>
                    <th>Hours</th>
                    <th>Payout</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(function (r) {
                    var derived = String(r.derived_status || r.status || "UNMARKED").toUpperCase();
                    var style = DERIVED_STATUS_STYLES[derived] || DERIVED_STATUS_STYLES.UNMARKED;
                    return (
                      <tr key={r.key || r.id}>
                        <td>{r.date || (r.check_in_at ? String(r.check_in_at).slice(0, 10) : "—")}</td>
                        <td>
                          {r.employee_name || r.employee_id}
                          {r.is_extra_partner ? (
                            <span className="mini-muted" style={{ marginLeft: 4 }}>
                              (relief)
                            </span>
                          ) : null}
                        </td>
                        <td>{r.patient_name || "—"}</td>
                        <td>{r.shift_type || "—"}</td>
                        <td>
                          <span
                            className="status"
                            style={{
                              background: style.bg,
                              border: "1px solid " + style.border,
                              color: style.text,
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 600
                            }}
                          >
                            {derived}
                          </span>
                        </td>
                        <td>{r.check_in_at ? String(r.check_in_at).slice(11, 16) : "—"}</td>
                        <td>{r.check_out_at ? String(r.check_out_at).slice(11, 16) : "—"}</td>
                        <td>{Number(r.hours || 0).toFixed(2)}</td>
                        <td>
                          {Number(r.payout || 0) > 0
                            ? "₹" + Number(r.payout).toLocaleString("en-IN", { maximumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td className="mini-muted">{r.notes || r.remarks || "—"}</td>
                        <td>
                          {r.attendance_id && canDelete ? (
                            <div className="button-row">
                              <button
                                className="button danger"
                                type="button"
                                onClick={function () {
                                  handleDelete(r.attendance_id);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <span className="mini-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ModuleShell>

        <div className="page-split">
          <div className="page-grid">
            <ModuleShell
              title={editingId ? "Edit attendance" : "Mark attendance"}
              description="Per-duty or standalone clock-in/out. Status auto-handles timestamp rules."
            >
              <form className="stack" onSubmit={handleSubmit}>
                <fieldset className="stack" disabled={!canWrite} style={{ border: 0, margin: 0, padding: 0 }}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="attendance-employee-12">Employee</label>
                    <select id="attendance-employee-12"
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
                    <label htmlFor="attendance-patient-optional-13">Patient (optional)</label>
                    <select id="attendance-patient-optional-13"
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
                    <label htmlFor="attendance-status-14">Status</label>
                    <select id="attendance-status-14"
                      value={form.status}
                      onChange={function (event) {
                        setForm({ ...form, status: event.target.value });
                      }}
                    >
                      {ATTENDANCE_STATUS_OPTIONS.map(function (o) {
                        return (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="attendance-shift-15">Shift</label>
                    <select id="attendance-shift-15"
                      value={form.shift_type}
                      onChange={function (event) {
                        setForm({ ...form, shift_type: event.target.value });
                      }}
                    >
                      {ATTENDANCE_SHIFT_OPTIONS.map(function (o) {
                        return (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="attendance-work-date-16">Work date</label>
                    <input id="attendance-work-date-16"
                      type="date"
                      value={form.work_date}
                      onChange={function (event) {
                        setForm({ ...form, work_date: event.target.value });
                      }}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="attendance-duty-id-optional-17">Duty id (optional)</label>
                    <input id="attendance-duty-id-optional-17"
                      value={form.duty_id}
                      onChange={function (event) {
                        setForm({ ...form, duty_id: event.target.value });
                      }}
                      placeholder="DTY-..."
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="attendance-check-in-18">Check-in</label>
                    <input id="attendance-check-in-18"
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
                    <label htmlFor="attendance-check-out-19">Check-out</label>
                    <input id="attendance-check-out-19"
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
                  <label htmlFor="attendance-notes-20">Notes</label>
                  <textarea id="attendance-notes-20"
                    rows="2"
                    value={form.notes}
                    onChange={function (event) {
                      setForm({ ...form, notes: event.target.value });
                    }}
                  />
                </div>
                <ErrorBanner message={error} />
                <SuccessBanner message={message} />
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
                </fieldset>
              </form>
            </ModuleShell>

            <ModuleShell
              title="Missing attendance"
              description="Duties scheduled in the range that don't yet have an attendance row."
            >
              <div className="toolbar">
                <div className="field">
                  <label htmlFor="attendance-employee-21">Employee</label>
                  <select id="attendance-employee-21"
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
                  <span aria-hidden="true">&nbsp;</span>
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
                              disabled={busy || !canWrite}
                            >
                              Present
                            </button>
                            <button
                              className="button danger"
                              type="button"
                              onClick={function () {
                                handleQuickMark(d, "ABSENT");
                              }}
                              disabled={busy || !canWrite}
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

        </div>
      </AppShell>
    </AuthGuard>
  );
}

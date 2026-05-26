"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { usePaginatedResource } from "@/hooks/use-paginated-resource";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import {
  inquiryPotentialOptions,
  inquirySourceOptions,
  inquiryStatusOptions
} from "@/lib/crm-options";
import { formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";

var OPEN_STATUSES = ["New", "Contacted", "FollowUp", "Negotiating"];
var CLOSED_STATUSES = ["Converted", "Closed", "Lost"];

function createInitialForm() {
  return {
    id: "",
    patient_name: "",
    mobile: "",
    area: "",
    city: "Ahmedabad",
    service_required: "",
    source: "WHATSAPP",
    potential: "WARM",
    status: "New",
    assigned_to: "",
    followup_date: "",
    emergency_level: null,
    flexibility_score: null,
    priority_score: null,
    rating_touched: {
      emergency_level: false,
      flexibility_score: false,
      priority_score: false
    },
    expected_updated_at: "",
    confirm_existing_patient: false,
    notes: ""
  };
}

function isOverdueFollowup(row) {
  var fd = row.followup_date;
  if (!fd) return false;
  if (CLOSED_STATUSES.indexOf(row.status || "") >= 0) return false;
  var d = Date.parse(fd);
  if (Number.isNaN(d)) return false;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today.getTime();
}

export default function InquiriesPage() {
  var auth = useAuth();
  var isAdmin = String(auth.profile?.role || "").trim().toUpperCase() === "ADMIN";
  var [search, setSearch] = useState("");
  var [debouncedSearch, setDebouncedSearch] = useState("");
  var [employees, setEmployees] = useState([]);
  var [potentialFilter, setPotentialFilter] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [sourceFilter, setSourceFilter] = useState("");
  var [openOnly, setOpenOnly] = useState(true);

  useEffect(
    function () {
      var handle = setTimeout(function () {
        setDebouncedSearch(search.trim());
      }, 300);
      return function () { clearTimeout(handle); };
    },
    [search]
  );

  useEffect(
    function () {
      request("/lookups/employees", null, auth.session)
        .then(function (rows) {
          setEmployees(Array.isArray(rows) ? rows : rows?.rows || rows?.data || []);
        })
        .catch(function () {
          setEmployees([]);
        });
    },
    [auth.session]
  );

  var listQuery = useMemo(
    function () {
      return {
        q: debouncedSearch || undefined,
        status: statusFilter || undefined,
        source: sourceFilter || undefined,
        open_only: openOnly ? "true" : undefined
      };
    },
    [debouncedSearch, statusFilter, sourceFilter, openOnly]
  );

  var resource = usePaginatedResource({
    basePath: "/inquiries",
    table: "hh_inquiries",
    channel: "inquiries",
    queryParams: listQuery,
    resetKey: debouncedSearch + "|" + statusFilter + "|" + sourceFilter + "|" + (openOnly ? "1" : "0"),
    pageSize: 50
  });
  var [form, setForm] = useState(createInitialForm());
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  var [statusDialog, setStatusDialog] = useState(null);
  var [deleteDialog, setDeleteDialog] = useState(null);
  var [convertDialog, setConvertDialog] = useState(null);
  var [conflictPrompt, setConflictPrompt] = useState(null);
  var [duplicatePatientPrompt, setDuplicatePatientPrompt] = useState(null);

  var filtered = useMemo(
    function () {
      if (!potentialFilter) return resource.data;
      return resource.data.filter(function (row) {
        return row.potential === potentialFilter;
      });
    },
    [resource.data, potentialFilter]
  );

  var overdueCount = useMemo(
    function () {
      return filtered.filter(function (row) { return isOverdueFollowup(row); }).length;
    },
    [filtered]
  );

  function updateField(name, value) {
    setForm(function (current) {
      var next = { ...current, [name]: value };
      if (name === "emergency_level" || name === "flexibility_score" || name === "priority_score") {
        next.rating_touched = { ...current.rating_touched, [name]: true };
      }
      return next;
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setError("");
    setMessage("");
    setConflictPrompt(null);
    setDuplicatePatientPrompt(null);
  }

  function editInquiry(row) {
    setForm({
      id: row.id,
      patient_name: row.patient_name || row.name || "",
      mobile: row.mobile || row.phone || "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      service_required: row.service_required || row.service || "",
      source: row.source || "WHATSAPP",
      potential: row.potential || "WARM",
      status: row.status || "New",
      assigned_to: row.assigned_to || "",
      followup_date: row.followup_date || "",
      emergency_level: row.emergency_level ?? row.rating_emergency ?? null,
      flexibility_score: row.flexibility_score ?? row.rating_flexibility ?? null,
      priority_score: row.priority_score ?? row.rating_overall ?? null,
      rating_touched: {
        emergency_level: row.emergency_level != null || row.rating_emergency != null,
        flexibility_score: row.flexibility_score != null || row.rating_flexibility != null,
        priority_score: row.priority_score != null || row.rating_overall != null
      },
      expected_updated_at: row.updated_at || "",
      confirm_existing_patient: false,
      notes: row.notes || row.remarks || ""
    });
    setError("");
    setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      var payload = {
        patient_name: form.patient_name,
        mobile: form.mobile,
        area: form.area,
        city: form.city,
        service_required: form.service_required,
        source: form.source,
        potential: form.potential,
        status: form.status,
        assigned_to: form.assigned_to || "",
        followup_date: form.followup_date || "",
        notes: form.notes
      };
      var touched = form.rating_touched || {};
      if (touched.emergency_level && form.emergency_level != null) {
        payload.emergency_level = Number(form.emergency_level);
      }
      if (touched.flexibility_score && form.flexibility_score != null) {
        payload.flexibility_score = Number(form.flexibility_score);
      }
      if (touched.priority_score && form.priority_score != null) {
        payload.priority_score = Number(form.priority_score);
      }
      if (form.id && form.expected_updated_at) {
        payload.expected_updated_at = form.expected_updated_at;
      }
      if (form.confirm_existing_patient) {
        payload.confirm_existing_patient = true;
      }
      await requestWithOfflineFallback(
        form.id ? "/inquiries/" + form.id : "/inquiries",
        { method: form.id ? "PUT" : "POST", body: payload },
        auth.session
      );
      await resource.reload();
      resetForm();
      setMessage(form.id ? "Inquiry updated" : "Inquiry created");
    } catch (submitError) {
      var code = submitError?.code;
      if (code === "conflict") {
        setConflictPrompt({
          actual: submitError?.details?.actual_updated_at,
          message: submitError.message || "Inquiry was modified by another user."
        });
      } else if (
        code === "duplicate" &&
        submitError?.details?.field === "phone_existing_patient" &&
        !form.id
      ) {
        setDuplicatePatientPrompt({
          message: submitError.message || "This phone is already a registered patient."
        });
      } else {
        setError(submitError.message || "Unable to save inquiry");
      }
    } finally {
      setBusy(false);
    }
  }

  async function reloadInquiryFromConflict() {
    if (!form.id) {
      setConflictPrompt(null);
      return;
    }
    setBusy(true);
    try {
      var fresh = await request("/inquiries/" + form.id, null, auth.session);
      editInquiry(fresh);
      setConflictPrompt(null);
      setMessage("Inquiry reloaded — your previous edits were discarded.");
    } catch (reloadError) {
      setError(reloadError.message || "Could not reload inquiry.");
    } finally {
      setBusy(false);
    }
  }

  function confirmExistingPatientAndResubmit() {
    setDuplicatePatientPrompt(null);
    setForm(function (current) { return { ...current, confirm_existing_patient: true }; });
    setMessage("Will save anyway on the next Save — press Save again.");
  }

  function openStatusDialog(row, nextStatus) {
    var rowStatus = row.status || "New";
    var reopening =
      (rowStatus === "Closed" || rowStatus === "Lost") &&
      OPEN_STATUSES.indexOf(nextStatus) >= 0;
    setStatusDialog({
      id: row.id,
      name: row.patient_name || row.name || row.id,
      nextStatus: nextStatus,
      reason: "",
      followup_date: row.followup_date || new Date().toISOString().slice(0, 10),
      requiresReason:
        nextStatus === "Closed" || nextStatus === "Lost" || reopening
    });
  }

  async function submitStatusDialog() {
    if (!statusDialog) return;
    if (
      (statusDialog.nextStatus === "FollowUp" || statusDialog.nextStatus === "Negotiating") &&
      !statusDialog.followup_date
    ) {
      setError("Follow-up date is required for this status");
      return;
    }
    if (statusDialog.requiresReason && !statusDialog.reason.trim()) {
      setError("Please provide a reason");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/inquiries/" + statusDialog.id + "/status",
        {
          method: "POST",
          body: {
            status: statusDialog.nextStatus,
            reason: statusDialog.reason.trim(),
            followup_date: statusDialog.followup_date || ""
          }
        },
        auth.session
      );
      setMessage("Inquiry → " + statusDialog.nextStatus);
      setStatusDialog(null);
      await resource.reload();
      if (form.id === statusDialog.id) resetForm();
    } catch (statusError) {
      setError(statusError.message || "Unable to change status");
    } finally {
      setBusy(false);
    }
  }

  function openDeleteDialog(row) {
    setDeleteDialog({
      id: row.id,
      name: row.patient_name || row.name || row.id,
      reason: "",
      hard: false
    });
  }

  async function submitDeleteDialog() {
    if (!deleteDialog) return;
    setBusy(true);
    setError("");
    try {
      var path = "/inquiries/" + deleteDialog.id;
      if (deleteDialog.hard) path += "?hard=1";
      var result = await requestWithOfflineFallback(
        path,
        { method: "DELETE", body: { reason: deleteDialog.reason.trim() } },
        auth.session
      );
      await resource.reload();
      if (form.id === deleteDialog.id) resetForm();
      setMessage(
        result && result.mode === "hard"
          ? "Inquiry permanently deleted"
          : "Inquiry closed (history preserved)"
      );
      setDeleteDialog(null);
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete inquiry");
    } finally {
      setBusy(false);
    }
  }

  function openConvertDialog(row) {
    setConvertDialog({
      id: row.id,
      name: row.patient_name || row.name || row.id,
      notes: row.notes || row.remarks || ""
    });
  }

  async function submitConvertDialog() {
    if (!convertDialog) return;
    setBusy(true);
    setError("");
    try {
      var data = await requestWithOfflineFallback(
        "/inquiries/" + convertDialog.id + "/convert",
        { method: "POST", body: { notes: convertDialog.notes } },
        auth.session
      );
      setMessage(
        data?.alreadyConverted
          ? "Already converted — patient " + (data.patient_id || "")
          : "Converted to patient " + (data?.patient_id || "OK")
      );
      setConvertDialog(null);
      await resource.reload();
    } catch (convertError) {
      setError(convertError.message || "Unable to convert inquiry");
    } finally {
      setBusy(false);
    }
  }

  function openInquiryPdf(row, hideMobile) {
    var body = [
      "<h2>Inquiry Summary</h2>",
      "<div class='meta'><strong>Patient:</strong> " + (row.patient_name || row.name) + "</div>",
      hideMobile ? "" : "<div class='meta'><strong>Mobile:</strong> " + (row.mobile || row.phone || "") + "</div>",
      "<div class='meta'><strong>Location:</strong> " + (row.area || "") + ", " + (row.city || "") + "</div>",
      "<div class='meta'><strong>Service Required:</strong> " + (row.service_required || row.service || "") + "</div>",
      "<div class='meta'><strong>Source:</strong> " + (row.source || "") + "</div>",
      "<div class='meta'><strong>Potential:</strong> " + (row.potential || "") + "</div>",
      "<div class='meta'><strong>Status:</strong> " + (row.status || "") + "</div>",
      "<table><thead><tr><th>Metric</th><th>Score</th></tr></thead><tbody>" +
        "<tr><td>Emergency Level</td><td>" + (row.emergency_level ?? row.rating_emergency ?? "-") + "/10</td></tr>" +
        "<tr><td>Flexibility</td><td>" + (row.flexibility_score ?? row.rating_flexibility ?? "-") + "/10</td></tr>" +
        "<tr><td>Overall Priority</td><td>" + (row.priority_score ?? row.rating_overall ?? "-") + "/10</td></tr>" +
      "</tbody></table>",
      "<div class='meta'><strong>Notes:</strong> " + (row.notes || row.remarks || "-") + "</div>",
      "<div class='stamp'>Created/Processed on " + formatDate(row.created_at) + "</div>"
    ].join("");
    openPrintWindow(hideMobile ? "Inquiry PDF (without mobile)" : "Inquiry PDF", body);
  }

  function sendWhatsApp(row) {
    var phone = row.mobile || row.phone || "";
    var text =
      "New Inquiry: " +
      (row.patient_name || row.name) +
      " needs " +
      (row.service_required || row.service || "") +
      " in " +
      (row.area || "") +
      ". Emergency: " +
      (row.emergency_level ?? row.rating_emergency ?? "-") +
      "/10. Please contact: " +
      phone +
      ". — Hominal Healthcare | 7211136600";
    window.open("https://wa.me/91" + phone + "?text=" + encodeURIComponent(text), "_blank");
  }

  return (
    <AuthGuard permission="inquiries.read">
      <AppShell title="Inquiries">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit Inquiry" : "Create Inquiry"}
            description="Capture leads with status workflow, follow-ups and convert-to-patient."
          >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label>Patient Name</label>
                  <input value={form.patient_name} onChange={function (event) { updateField("patient_name", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Mobile</label>
                  <input value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Area</label>
                  <input value={form.area} onChange={function (event) { updateField("area", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>City</label>
                  <input value={form.city} onChange={function (event) { updateField("city", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Service Required</label>
                  <input value={form.service_required} onChange={function (event) { updateField("service_required", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Source</label>
                  <select value={form.source} onChange={function (event) { updateField("source", event.target.value); }}>
                    {inquirySourceOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Potential</label>
                  <select value={form.potential} onChange={function (event) { updateField("potential", event.target.value); }}>
                    {inquiryPotentialOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={form.status} onChange={function (event) { updateField("status", event.target.value); }}>
                    {inquiryStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Assigned to</label>
                  <select value={form.assigned_to} onChange={function (event) { updateField("assigned_to", event.target.value); }}>
                    <option value="">Unassigned</option>
                    {employees.map(function (emp) {
                      var label = emp.full_name || emp.name || emp.id;
                      return <option key={emp.id} value={emp.id}>{label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Follow-up date</label>
                  <input
                    type="date"
                    value={form.followup_date}
                    onChange={function (event) { updateField("followup_date", event.target.value); }}
                    required={form.status === "FollowUp" || form.status === "Negotiating"}
                  />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Emergency Level (1-10)</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={form.emergency_level != null ? form.emergency_level : 5}
                    onChange={function (event) { updateField("emergency_level", event.target.value); }}
                  />
                  <small>{form.emergency_level != null ? form.emergency_level : "Not rated"}/10</small>
                </div>
                <div className="field">
                  <label>Flexibility (1-10)</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={form.flexibility_score != null ? form.flexibility_score : 5}
                    onChange={function (event) { updateField("flexibility_score", event.target.value); }}
                  />
                  <small>{form.flexibility_score != null ? form.flexibility_score : "Not rated"}/10</small>
                </div>
                <div className="field">
                  <label>Priority (1-10)</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={form.priority_score != null ? form.priority_score : 5}
                    onChange={function (event) { updateField("priority_score", event.target.value); }}
                  />
                  <small>{form.priority_score != null ? form.priority_score : "Not rated"}/10</small>
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows="3" value={form.notes} onChange={function (event) { updateField("notes", event.target.value); }} />
              </div>
              {conflictPrompt ? (
                <div className="error-text" style={{ border: "1px solid var(--warn, #d97706)", background: "rgba(217,119,6,0.08)", padding: "10px 12px", borderRadius: 6 }}>
                  <div style={{ marginBottom: 6 }}>
                    <strong>Concurrent edit detected.</strong> {conflictPrompt.message}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button className="button primary" type="button" onClick={reloadInquiryFromConflict} disabled={busy}>Reload latest</button>
                    <button className="button ghost" type="button" onClick={function () { setConflictPrompt(null); }} disabled={busy}>Dismiss</button>
                  </div>
                </div>
              ) : null}
              {duplicatePatientPrompt ? (
                <div className="error-text" style={{ border: "1px solid var(--warn, #d97706)", background: "rgba(217,119,6,0.08)", padding: "10px 12px", borderRadius: 6 }}>
                  <div style={{ marginBottom: 6 }}>
                    <strong>Existing patient.</strong> {duplicatePatientPrompt.message}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button className="button primary" type="button" onClick={confirmExistingPatientAndResubmit} disabled={busy}>Save inquiry anyway</button>
                    <button className="button ghost" type="button" onClick={function () { setDuplicatePatientPrompt(null); }} disabled={busy}>Cancel</button>
                  </div>
                </div>
              ) : null}
              {error && !conflictPrompt && !duplicatePatientPrompt ? (
                <div className="error-text">{error}</div>
              ) : null}
              {!error && !conflictPrompt && !duplicatePatientPrompt && resource.error ? (
                <div className="error-text">Live inquiry list error — {resource.error}</div>
              ) : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving..." : form.id ? "Update Inquiry" : "Create Inquiry"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <ModuleShell title="Inquiry Tracker" description="Status workflow, conversion to patient, follow-ups, WhatsApp & PDF.">
            <div className="toolbar">
              <div className="field">
                <label>Search</label>
                <input value={search} onChange={function (event) { setSearch(event.target.value); }} placeholder="Name, mobile, service or source" />
              </div>
              <div className="field">
                <label>Status</label>
                <select value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                  <option value="">All</option>
                  {inquiryStatusOptions.map(function (item) {
                    return <option key={item.value} value={item.value}>{item.label}</option>;
                  })}
                </select>
              </div>
              <div className="field">
                <label>Potential</label>
                <select value={potentialFilter} onChange={function (event) { setPotentialFilter(event.target.value); }}>
                  <option value="">All</option>
                  {inquiryPotentialOptions.map(function (item) {
                    return <option key={item.value} value={item.value}>{item.label}</option>;
                  })}
                </select>
              </div>
              <div className="field">
                <label>Source</label>
                <select value={sourceFilter} onChange={function (event) { setSourceFilter(event.target.value); }}>
                  <option value="">All</option>
                  {inquirySourceOptions.map(function (item) {
                    return <option key={item.value} value={item.value}>{item.label}</option>;
                  })}
                </select>
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={openOnly} onChange={function (event) { setOpenOnly(event.target.checked); }} />
                  &nbsp;Open only
                </label>
              </div>
            </div>
            <PaginationBar
              page={resource.page}
              pageSize={resource.pageSize}
              total={resource.total}
              onPageChange={resource.setPage}
              onPageSizeChange={resource.setPageSize}
            />
            <div className="mini-muted" style={{ margin: "0.25rem 0 0.75rem" }}>
              {debouncedSearch ? "Search: \"" + debouncedSearch + "\" — " : ""}
              {resource.total} inquir{resource.total === 1 ? "y" : "ies"} total
              {overdueCount ? " · " + overdueCount + " overdue on this page" : ""}
              {potentialFilter ? " · potential filter applies to this page only" : ""}
              {resource.loading ? " (loading...)" : ""}
            </div>
            {!filtered.length ? (
              <EmptyState
                title={resource.loading ? "Loading inquiries..." : "No matching inquiries"}
                description={
                  debouncedSearch
                    ? "No inquiry matches \"" + debouncedSearch + "\"."
                    : "All new leads, telecalling callbacks, and hot admissions will appear here."
                }
              />
            ) : (
              <div className="record-list">
                {filtered.map(function (row, index) {
                  var status = row.status || "New";
                  var isClosed = CLOSED_STATUSES.indexOf(status) >= 0;
                  var overdue = isOverdueFollowup(row);
                  return (
                    <div className="record-card" key={row.id}>
                      <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <h3>
                            <span className="row-number">#{index + 1}</span>
                            {row.patient_name || row.name}
                            {overdue ? <span className="status" style={{ marginLeft: 8, background: "var(--danger)" }}>Overdue</span> : null}
                          </h3>
                          <div className="record-meta">
                            <span>{row.mobile || row.phone}</span>
                            <span>{row.area || ""}, {row.city || ""}</span>
                            <span>{row.service_required || row.service || ""}</span>
                            <span className={"status " + String(status).toLowerCase()}>{status}</span>
                          </div>
                        </div>
                        <span className={"status " + String(row.potential || "").toLowerCase()}>{row.potential}</span>
                      </div>
                      <div className="helper-box" style={{ marginTop: 12 }}>
                        Emergency {row.emergency_level ?? row.rating_emergency ?? "-"}/10 ·
                        Flexibility {row.flexibility_score ?? row.rating_flexibility ?? "-"}/10 ·
                        Priority {row.priority_score ?? row.rating_overall ?? "-"}/10
                        {row.followup_date ? " · Follow-up " + row.followup_date : ""}
                      </div>
                      <div className="record-meta" style={{ marginTop: 12 }}>
                        <span>{row.source}</span>
                        <span>{formatDate(row.created_at)}</span>
                      </div>
                      <div className="button-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                        <button className="button secondary" type="button" onClick={function () { editInquiry(row); }}>
                          Edit
                        </button>
                        {!isClosed ? (
                          <button className="button success" type="button" onClick={function () { openConvertDialog(row); }} disabled={busy}>
                            Convert to patient
                          </button>
                        ) : null}
                        {OPEN_STATUSES.indexOf(status) >= 0 && status !== "Contacted" ? (
                          <button className="button secondary" type="button" onClick={function () { openStatusDialog(row, "Contacted"); }} disabled={busy}>
                            Mark Contacted
                          </button>
                        ) : null}
                        {status !== "FollowUp" && !isClosed ? (
                          <button className="button secondary" type="button" onClick={function () { openStatusDialog(row, "FollowUp"); }} disabled={busy}>
                            Follow-up
                          </button>
                        ) : null}
                        {status !== "Negotiating" && !isClosed ? (
                          <button className="button secondary" type="button" onClick={function () { openStatusDialog(row, "Negotiating"); }} disabled={busy}>
                            Negotiating
                          </button>
                        ) : null}
                        {!isClosed ? (
                          <button className="button danger" type="button" onClick={function () { openStatusDialog(row, "Lost"); }} disabled={busy}>
                            Lost
                          </button>
                        ) : null}
                        {(status === "Closed" || status === "Lost") ? (
                          <button className="button primary" type="button" onClick={function () { openStatusDialog(row, "New"); }} disabled={busy}>
                            Reopen
                          </button>
                        ) : null}
                        <button className="button secondary" type="button" onClick={function () { openInquiryPdf(row, false); }}>
                          PDF
                        </button>
                        <button className="button secondary" type="button" onClick={function () { openInquiryPdf(row, true); }}>
                          PDF (no mobile)
                        </button>
                        <button className="button success" type="button" onClick={function () { sendWhatsApp(row); }}>
                          WhatsApp
                        </button>
                        <button className="button danger" type="button" onClick={function () { openDeleteDialog(row); }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ModuleShell>
        </div>
      </AppShell>

      {statusDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setStatusDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Change status → {statusDialog.nextStatus}</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setStatusDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">{statusDialog.name} — recorded in the audit log.</p>
            {statusDialog.nextStatus === "FollowUp" || statusDialog.nextStatus === "Negotiating" ? (
              <div className="field">
                <label>Follow-up date</label>
                <input
                  type="date"
                  value={statusDialog.followup_date}
                  onChange={function (e) {
                    var v = e.target.value;
                    setStatusDialog(function (c) { return c ? { ...c, followup_date: v } : c; });
                  }}
                />
              </div>
            ) : null}
            <div className="field">
              <label>
                Reason
                {statusDialog.nextStatus === "Closed" || statusDialog.nextStatus === "Lost" || statusDialog.nextStatus === "New"
                  ? " (required to reopen/close)"
                  : " (optional)"}
              </label>
              <textarea
                rows="3"
                value={statusDialog.reason}
                onChange={function (e) {
                  var v = e.target.value;
                  setStatusDialog(function (c) { return c ? { ...c, reason: v } : c; });
                }}
              />
            </div>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setStatusDialog(null); }}>Cancel</button>
              <button className="button primary" type="button" disabled={busy} onClick={submitStatusDialog}>
                {busy ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setDeleteDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Delete / close inquiry</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setDeleteDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">
              By default the inquiry is closed (status Closed) so lead-source analytics are preserved.
              {isAdmin ? " Admins can permanently delete." : ""}
            </p>
            <div className="field">
              <label>Reason (optional)</label>
              <textarea
                rows="3"
                value={deleteDialog.reason}
                onChange={function (e) {
                  var v = e.target.value;
                  setDeleteDialog(function (c) { return c ? { ...c, reason: v } : c; });
                }}
              />
            </div>
            {isAdmin ? (
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={deleteDialog.hard}
                    onChange={function (e) {
                      var v = e.target.checked;
                      setDeleteDialog(function (c) { return c ? { ...c, hard: v } : c; });
                    }}
                  />
                  &nbsp;Permanently delete (cannot undo)
                </label>
              </div>
            ) : null}
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setDeleteDialog(null); }}>Cancel</button>
              <button className="button danger" type="button" disabled={busy} onClick={submitDeleteDialog}>
                {busy ? "Working..." : deleteDialog.hard ? "Delete permanently" : "Close inquiry"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {convertDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setConvertDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Convert to patient</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setConvertDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">
              {convertDialog.name} — creates or links a patient by mobile via the server RPC.
            </p>
            <div className="field">
              <label>Conversion notes (optional)</label>
              <textarea
                rows="3"
                value={convertDialog.notes}
                onChange={function (e) {
                  var v = e.target.value;
                  setConvertDialog(function (c) { return c ? { ...c, notes: v } : c; });
                }}
              />
            </div>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setConvertDialog(null); }}>Cancel</button>
              <button className="button success" type="button" disabled={busy} onClick={submitConvertDialog}>
                {busy ? "Converting..." : "Confirm convert"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AuthGuard>
  );
}

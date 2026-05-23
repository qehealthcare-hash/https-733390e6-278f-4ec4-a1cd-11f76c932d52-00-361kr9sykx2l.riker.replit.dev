"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";
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
    followup_date: "",
    emergency_level: 5,
    flexibility_score: 5,
    priority_score: 5,
    notes: ""
  };
}

export default function InquiriesPage() {
  var auth = useAuth();
  var resource = useRealtimeResource({
    apiPath: "/inquiries",
    table: "hh_inquiries",
    channel: "inquiries"
  });
  var [form, setForm] = useState(createInitialForm());
  var [busy, setBusy] = useState(false);
  var [search, setSearch] = useState("");
  var [potentialFilter, setPotentialFilter] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [sourceFilter, setSourceFilter] = useState("");
  var [openOnly, setOpenOnly] = useState(true);
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  var filtered = useMemo(
    function () {
      return resource.data.filter(function (row) {
        var hay = [row.patient_name || row.name, row.mobile || row.phone, row.area, row.service_required || row.service, row.source]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        var matchesSearch = !search || hay.indexOf(search.toLowerCase()) >= 0;
        var matchesPotential = !potentialFilter || row.potential === potentialFilter;
        var matchesStatus = !statusFilter || row.status === statusFilter;
        var matchesSource = !sourceFilter || row.source === sourceFilter;
        var matchesOpen = !openOnly || OPEN_STATUSES.indexOf(row.status || "New") >= 0;
        return matchesSearch && matchesPotential && matchesStatus && matchesSource && matchesOpen;
      });
    },
    [resource.data, search, potentialFilter, statusFilter, sourceFilter, openOnly]
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
      followup_date: row.followup_date || "",
      emergency_level: row.emergency_level ?? row.rating_emergency ?? 5,
      flexibility_score: row.flexibility_score ?? row.rating_flexibility ?? 5,
      priority_score: row.priority_score ?? row.rating_overall ?? 5,
      notes: row.notes || row.remarks || ""
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        form.id ? "/inquiries/" + form.id : "/inquiries",
        {
          method: form.id ? "PUT" : "POST",
          body: {
            patient_name: form.patient_name,
            mobile: form.mobile,
            area: form.area,
            city: form.city,
            service_required: form.service_required,
            source: form.source,
            potential: form.potential,
            status: form.status,
            followup_date: form.followup_date || "",
            emergency_level: Number(form.emergency_level),
            flexibility_score: Number(form.flexibility_score),
            priority_score: Number(form.priority_score),
            notes: form.notes
          }
        },
        auth.session
      );
      await resource.reload();
      resetForm();
      setMessage(form.id ? "Inquiry updated" : "Inquiry created");
    } catch (submitError) {
      setError(submitError.message || "Unable to save inquiry");
    } finally {
      setBusy(false);
    }
  }

  async function deleteInquiry(id) {
    if (!window.confirm("Delete this inquiry?")) return;
    setBusy(true);
    try {
      await requestWithOfflineFallback("/inquiries/" + id, { method: "DELETE" }, auth.session);
      await resource.reload();
      if (form.id === id) resetForm();
      setMessage("Inquiry deleted");
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete inquiry");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(row, nextStatus) {
    var reason = "";
    var followup = row.followup_date || "";
    if (nextStatus === "FollowUp" || nextStatus === "Negotiating") {
      followup = window.prompt(
        "Follow-up date (YYYY-MM-DD)",
        followup || new Date().toISOString().slice(0, 10)
      ) || "";
      if (!followup) return;
    }
    if (nextStatus === "Closed" || nextStatus === "Lost") {
      reason = window.prompt("Reason for " + nextStatus.toLowerCase(), "") || "";
    }
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback(
        "/inquiries/" + row.id + "/status",
        {
          method: "POST",
          body: { status: nextStatus, reason: reason, followup_date: followup }
        },
        auth.session
      );
      setMessage("Inquiry → " + nextStatus);
      await resource.reload();
    } catch (statusError) {
      setError(statusError.message || "Unable to change status");
    } finally {
      setBusy(false);
    }
  }

  async function convertToPatient(row) {
    if (!window.confirm("Convert " + (row.patient_name || row.name || "this lead") + " to a Patient?")) return;
    setBusy(true);
    setError("");
    try {
      var data = await requestWithOfflineFallback(
        "/inquiries/" + row.id + "/convert",
        { method: "POST", body: { notes: row.notes || row.remarks || "" } },
        auth.session
      );
      setMessage("Converted to patient " + (data?.patient_id || "OK"));
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
          <ModuleShell title={form.id ? "Edit Inquiry" : "Create Inquiry"} description="Capture leads with status workflow, follow-ups and convert-to-patient.">
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
                  <input type="range" min="1" max="10" value={form.emergency_level} onChange={function (event) { updateField("emergency_level", event.target.value); }} />
                  <small>{form.emergency_level}/10</small>
                </div>
                <div className="field">
                  <label>Flexibility (1-10)</label>
                  <input type="range" min="1" max="10" value={form.flexibility_score} onChange={function (event) { updateField("flexibility_score", event.target.value); }} />
                  <small>{form.flexibility_score}/10</small>
                </div>
                <div className="field">
                  <label>Priority (1-10)</label>
                  <input type="range" min="1" max="10" value={form.priority_score} onChange={function (event) { updateField("priority_score", event.target.value); }} />
                  <small>{form.priority_score}/10</small>
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea rows="3" value={form.notes} onChange={function (event) { updateField("notes", event.target.value); }} />
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {!error && resource.error ? (
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
                  <input
                    type="checkbox"
                    checked={openOnly}
                    onChange={function (event) {
                      setOpenOnly(event.target.checked);
                    }}
                  />
                  &nbsp;Open only
                </label>
              </div>
            </div>
            {!filtered.length ? (
              <EmptyState
                title={resource.loading ? "Loading inquiries..." : "No matching inquiries"}
                description="All new leads, telecalling callbacks, and hot admissions will appear here."
              />
            ) : (
              <div className="record-list">
                {filtered.map(function (row, index) {
                  var status = row.status || "New";
                  var isClosed = CLOSED_STATUSES.indexOf(status) >= 0;
                  return (
                    <div className="record-card" key={row.id}>
                      <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <h3>
                            <span className="row-number">#{index + 1}</span>
                            {row.patient_name || row.name}
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
                          <button
                            className="button success"
                            type="button"
                            onClick={function () {
                              convertToPatient(row);
                            }}
                            disabled={busy}
                          >
                            Convert to patient
                          </button>
                        ) : null}
                        {OPEN_STATUSES.indexOf(status) >= 0 && status !== "Contacted" ? (
                          <button
                            className="button secondary"
                            type="button"
                            onClick={function () {
                              changeStatus(row, "Contacted");
                            }}
                            disabled={busy}
                          >
                            Mark Contacted
                          </button>
                        ) : null}
                        {status !== "FollowUp" && !isClosed ? (
                          <button
                            className="button secondary"
                            type="button"
                            onClick={function () {
                              changeStatus(row, "FollowUp");
                            }}
                            disabled={busy}
                          >
                            Follow-up
                          </button>
                        ) : null}
                        {status !== "Negotiating" && !isClosed ? (
                          <button
                            className="button secondary"
                            type="button"
                            onClick={function () {
                              changeStatus(row, "Negotiating");
                            }}
                            disabled={busy}
                          >
                            Negotiating
                          </button>
                        ) : null}
                        {!isClosed ? (
                          <button
                            className="button danger"
                            type="button"
                            onClick={function () {
                              changeStatus(row, "Lost");
                            }}
                            disabled={busy}
                          >
                            Lost
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
                        <button className="button danger" type="button" onClick={function () { deleteInquiry(row.id); }}>
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
    </AuthGuard>
  );
}

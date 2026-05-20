"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";
import { useAuth } from "@/components/providers/auth-provider";
import { requestWithOfflineFallback } from "@/lib/api-client";
import { inquiryPotentialOptions, inquirySourceOptions } from "@/lib/crm-options";
import { formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";

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
  var [error, setError] = useState("");
  var [message, setMessage] = useState("");

  var filtered = useMemo(
    function () {
      return resource.data.filter(function (row) {
        var hay = [row.patient_name, row.mobile, row.area, row.service_required, row.source].join(" ").toLowerCase();
        var matchesSearch = !search || hay.indexOf(search.toLowerCase()) >= 0;
        var matchesPotential = !potentialFilter || row.potential === potentialFilter;
        return matchesSearch && matchesPotential;
      });
    },
    [resource.data, search, potentialFilter]
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
      patient_name: row.patient_name || "",
      mobile: row.mobile || "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      service_required: row.service_required || "",
      source: row.source || "WHATSAPP",
      potential: row.potential || "WARM",
      emergency_level: row.emergency_level || 5,
      flexibility_score: row.flexibility_score || 5,
      priority_score: row.priority_score || 5,
      notes: row.notes || ""
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

  function openInquiryPdf(row, hideMobile) {
    var body = [
      "<h2>Inquiry Summary</h2>",
      "<div class='meta'><strong>Patient:</strong> " + row.patient_name + "</div>",
      hideMobile ? "" : "<div class='meta'><strong>Mobile:</strong> " + row.mobile + "</div>",
      "<div class='meta'><strong>Location:</strong> " + row.area + ", " + row.city + "</div>",
      "<div class='meta'><strong>Service Required:</strong> " + row.service_required + "</div>",
      "<div class='meta'><strong>Source:</strong> " + row.source + "</div>",
      "<div class='meta'><strong>Potential:</strong> " + row.potential + "</div>",
      "<table><thead><tr><th>Metric</th><th>Score</th></tr></thead><tbody>" +
        "<tr><td>Emergency Level</td><td>" + row.emergency_level + "/10</td></tr>" +
        "<tr><td>Flexibility</td><td>" + row.flexibility_score + "/10</td></tr>" +
        "<tr><td>Overall Priority</td><td>" + row.priority_score + "/10</td></tr>" +
      "</tbody></table>",
      "<div class='meta'><strong>Notes:</strong> " + (row.notes || "-") + "</div>",
      "<div class='stamp'>Created/Processed on " + formatDate(row.created_at) + "</div>"
    ].join("");
    openPrintWindow(hideMobile ? "Inquiry PDF (without mobile)" : "Inquiry PDF", body);
  }

  function sendWhatsApp(row) {
    var text =
      "New Inquiry: " +
      row.patient_name +
      " needs " +
      row.service_required +
      " in " +
      row.area +
      ". Emergency: " +
      row.emergency_level +
      "/10. Please contact: " +
      row.mobile +
      ". — Hominal Healthcare | 7211136600";
    window.open("https://wa.me/91" + row.mobile + "?text=" + encodeURIComponent(text), "_blank");
  }

  return (
    <AuthGuard permission="inquiries.read">
      <AppShell title="Inquiries">
        <div className="page-split">
          <ModuleShell title={form.id ? "Edit Inquiry" : "Create Inquiry"} description="Hot, warm, and cold leads with printable and shareable summaries">
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

          <ModuleShell title="Inquiry Tracker" description="Printable and WhatsApp-shareable lead queue">
            <div className="toolbar">
              <div className="field">
                <label>Search</label>
                <input value={search} onChange={function (event) { setSearch(event.target.value); }} placeholder="Name, mobile, service or source" />
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
            </div>
            {!filtered.length ? (
              <EmptyState
                title={resource.loading ? "Loading inquiries..." : "No matching inquiries"}
                description="All new leads, telecalling callbacks, and hot admissions will appear here."
              />
            ) : (
              <div className="record-list">
                {filtered.map(function (row) {
                  return (
                    <div className="record-card" key={row.id}>
                      <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <h3>{row.patient_name}</h3>
                          <div className="record-meta">
                            <span>{row.mobile}</span>
                            <span>{row.area}, {row.city}</span>
                            <span>{row.service_required}</span>
                          </div>
                        </div>
                        <span className={"status " + String(row.potential || "").toLowerCase()}>{row.potential}</span>
                      </div>
                      <div className="helper-box" style={{ marginTop: 12 }}>
                        Emergency {row.emergency_level}/10 | Flexibility {row.flexibility_score}/10 | Priority {row.priority_score}/10
                      </div>
                      <div className="record-meta" style={{ marginTop: 12 }}>
                        <span>{row.source}</span>
                        <span>{formatDate(row.created_at)}</span>
                      </div>
                      <div className="button-row" style={{ marginTop: 12 }}>
                        <button className="button secondary" type="button" onClick={function () { editInquiry(row); }}>
                          Edit
                        </button>
                        <button className="button secondary" type="button" onClick={function () { openInquiryPdf(row, false); }}>
                          PDF with mobile
                        </button>
                        <button className="button secondary" type="button" onClick={function () { openInquiryPdf(row, true); }}>
                          PDF without mobile
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import { patientStatusOptions, shiftOptions } from "@/lib/crm-options";
import { formatDate, slugToText } from "@/lib/formatters";
import { downloadCsv } from "@/lib/csv";
import { uploadDocument } from "@/lib/uploads";

function createInitialForm() {
  return {
    id: "",
    full_name: "",
    age: 0,
    gender: "Female",
    address: "",
    area: "",
    city: "Ahmedabad",
    pincode: "",
    mobile: "",
    disease_condition: "",
    assigned_staff_id: "",
    shift_type: "DAY",
    start_date: new Date().toISOString().slice(0, 10),
    status: "ACTIVE",
    close_reason: "",
    documents: [],
    relative_contacts: [
      { name: "", phone: "" },
      { name: "", phone: "" },
      { name: "", phone: "" }
    ]
  };
}

export default function PatientsPage() {
  var auth = useAuth();
  var resource = useRealtimeResource({
    apiPath: "/patients",
    table: "hh_patients",
    channel: "hh_patients"
  });
  var [employees, setEmployees] = useState([]);
  var [form, setForm] = useState(createInitialForm());
  var [busy, setBusy] = useState(false);
  var [message, setMessage] = useState("");
  var [error, setError] = useState("");
  var [search, setSearch] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [sortOrder, setSortOrder] = useState("asc");

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      request("/lookups/employees", null, auth.session)
        .then(setEmployees)
        .catch(function () {
          setEmployees([]);
        });
    },
    [auth.session]
  );

  var filtered = useMemo(
    function () {
      return resource.data
        .filter(function (row) {
        var hay = [row.full_name, row.mobile, row.address, row.area, row.pincode].join(" ").toLowerCase();
        var matchesSearch = !search || hay.indexOf(search.toLowerCase()) >= 0;
        var matchesStatus = !statusFilter || row.status === statusFilter;
        return matchesSearch && matchesStatus;
        })
        .slice()
        .sort(function (left, right) {
          var leftTime = new Date(left.registered_at || left.created_at || 0).getTime();
          var rightTime = new Date(right.registered_at || right.created_at || 0).getTime();
          return sortOrder === "asc" ? leftTime - rightTime : rightTime - leftTime;
        });
    },
    [resource.data, search, statusFilter, sortOrder]
  );

  function toggleRegisteredSort() {
    setSortOrder(function (current) {
      return current === "asc" ? "desc" : "asc";
    });
  }

  function exportPatientsCsv() {
    downloadCsv(
      "patients.csv",
      filtered.map(function (row) {
        return {
          patient_id: row.id,
          name: row.full_name,
          age_gender: String(row.age || "") + " / " + String(row.gender || ""),
          phone: row.mobile || "",
          address: row.address || "",
          registered: row.registered_at || row.created_at || "",
          status: row.status || "",
          area: row.area || "",
          city: row.city || "",
          pincode: row.pincode || "",
          shift_type: row.shift_type || "",
          disease_condition: row.disease_condition || "",
          assigned_staff: row.employees?.full_name || "",
          close_reason: row.close_reason || ""
        };
      })
    );
  }

  async function handleUpload(event) {
    var files = Array.from(event.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      var uploaded = [];
      for (var i = 0; i < files.length; i += 1) {
        uploaded.push(
          await uploadDocument({
            bucket: "patient-documents",
            file: files[i],
            session: auth.session,
            supabase: auth.supabase
          })
        );
      }
      setForm(function (current) {
        return {
          ...current,
          documents: current.documents.concat(uploaded)
        };
      });
      setMessage("Patient documents uploaded");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload patient documents");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  function updateField(name, value) {
    setForm(function (current) {
      return { ...current, [name]: value };
    });
  }

  function updateContact(index, key, value) {
    setForm(function (current) {
      var next = current.relative_contacts.slice();
      next[index] = { ...next[index], [key]: value };
      return { ...current, relative_contacts: next };
    });
  }

  function editPatient(row) {
    setError("");
    setMessage("");
    setForm({
      id: row.id,
      full_name: row.full_name || "",
      age: row.age || 0,
      gender: row.gender || "Female",
      address: row.address || "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      pincode: row.pincode || "",
      mobile: row.mobile || "",
      disease_condition: row.disease_condition || "",
      assigned_staff_id: row.assigned_staff_id || "",
      shift_type: row.shift_type || "DAY",
      start_date: row.start_date || new Date().toISOString().slice(0, 10),
      status: row.status || "ACTIVE",
      close_reason: row.close_reason || "",
      documents: row.patient_documents || [],
      relative_contacts: (row.relative_contacts && row.relative_contacts.length
        ? row.relative_contacts
        : createInitialForm().relative_contacts
      ).concat(createInitialForm().relative_contacts).slice(0, 3)
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setError("");
    setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (form.status === "CLOSED" && !form.close_reason.trim()) {
        throw new Error("Closing reason is required when patient status is Closed");
      }
      var payload = {
        full_name: form.full_name,
        age: Number(form.age),
        gender: form.gender,
        address: form.address || null,
        area: form.area,
        city: form.city,
        pincode: form.pincode,
        mobile: form.mobile,
        disease_condition: form.disease_condition,
        assigned_staff_id: form.assigned_staff_id || null,
        shift_type: form.shift_type,
        start_date: form.start_date,
        status: form.status,
        close_reason: form.close_reason || null,
        documents: form.documents,
        relative_contacts: form.relative_contacts.filter(function (item) {
          return item.name && item.phone;
        })
      };
      await requestWithOfflineFallback(
        form.id ? "/patients/" + form.id : "/patients",
        {
          method: form.id ? "PUT" : "POST",
          body: payload
        },
        auth.session
      );
      await resource.reload();
      resetForm();
      setMessage(form.id ? "Patient updated successfully" : "Patient created successfully");
    } catch (submitError) {
      setError(submitError.message || "Unable to save patient");
    } finally {
      setBusy(false);
    }
  }

  async function deletePatient(id) {
    if (!window.confirm("Delete this patient?")) return;
    setBusy(true);
    setError("");
    try {
      await requestWithOfflineFallback("/patients/" + id, { method: "DELETE" }, auth.session);
      await resource.reload();
      if (form.id === id) resetForm();
      setMessage("Patient deleted");
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete patient");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="patients.read">
      <AppShell title="Patients">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit Patient" : "Add Patient"}
            description="Cloud-synced patient registry with mandatory close reason and document support"
          >
            <form className="stack" onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="field">
                  <label>Name</label>
                  <input value={form.full_name} onChange={function (event) { updateField("full_name", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Mobile</label>
                  <input value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Age</label>
                  <input type="number" min="0" value={form.age} onChange={function (event) { updateField("age", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Gender</label>
                  <select value={form.gender} onChange={function (event) { updateField("gender", event.target.value); }}>
                    <option>Female</option>
                    <option>Male</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="field">
                  <label>Shift Type</label>
                  <select value={form.shift_type} onChange={function (event) { updateField("shift_type", event.target.value); }}>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Start Date</label>
                  <input type="date" value={form.start_date} onChange={function (event) { updateField("start_date", event.target.value); }} required />
                </div>
              </div>
              <div className="field">
                <label>Disease / Condition</label>
                <textarea rows="3" value={form.disease_condition} onChange={function (event) { updateField("disease_condition", event.target.value); }} required />
              </div>
              <div className="field">
                <label>Address</label>
                <textarea rows="3" maxLength="500" value={form.address} onChange={function (event) { updateField("address", event.target.value); }} />
                <small>Optional. Up to 500 characters.</small>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Area</label>
                  <input value={form.area} onChange={function (event) { updateField("area", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>City</label>
                  <input value={form.city} onChange={function (event) { updateField("city", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Pincode</label>
                  <input value={form.pincode} onChange={function (event) { updateField("pincode", event.target.value); }} required />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Assigned Staff</label>
                  <select value={form.assigned_staff_id} onChange={function (event) { updateField("assigned_staff_id", event.target.value); }}>
                    <option value="">Select staff</option>
                    {employees.map(function (employee) {
                      return <option key={employee.id} value={employee.id}>{employee.full_name} ({slugToText(employee.role)})</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={form.status} onChange={function (event) { updateField("status", event.target.value); }}>
                    {patientStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
              </div>
              {form.status === "CLOSED" ? (
                <div className="field">
                  <label>Reason for closing</label>
                  <textarea rows="2" value={form.close_reason} onChange={function (event) { updateField("close_reason", event.target.value); }} required />
                </div>
              ) : null}
              <div className="stack">
                <div className="label-stack">
                  <strong>Relative Contacts</strong>
                  <div className="mini-muted">Up to three family or emergency contacts.</div>
                </div>
                {form.relative_contacts.map(function (contact, index) {
                  return (
                    <div className="grid-2" key={index}>
                      <div className="field">
                        <label>Relative {index + 1} Name</label>
                        <input value={contact.name} onChange={function (event) { updateContact(index, "name", event.target.value); }} />
                      </div>
                      <div className="field">
                        <label>Relative {index + 1} Phone</label>
                        <input value={contact.phone} onChange={function (event) { updateContact(index, "phone", event.target.value); }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="field">
                <label>Patient Documents</label>
                <input type="file" multiple onChange={handleUpload} />
                <small>Upload discharge papers, prescriptions, or ID reference files.</small>
              </div>
              <div className="document-list">
                {form.documents.map(function (doc, index) {
                  return (
                    <div className="document-item" key={doc.path || index}>
                      <div>{doc.file_name}</div>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={function () {
                          setForm(function (current) {
                            return {
                              ...current,
                              documents: current.documents.filter(function (item) {
                                return item.path !== doc.path;
                              })
                            };
                          });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
              {error ? <div className="error-text">{error}</div> : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving..." : form.id ? "Update Patient" : "Create Patient"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <div className="page-grid">
            <ModuleShell
              title="Live Patient Registry"
              description="Active and closed patient records across devices"
              actions={
                <div className="button-row">
                  <button className="button secondary" type="button" onClick={exportPatientsCsv}>
                    Export CSV
                  </button>
                  <button className="button secondary" type="button" onClick={resource.reload}>
                    Refresh
                  </button>
                </div>
              }
            >
              <div className="toolbar">
                <div className="field">
                  <label>Search</label>
                  <input value={search} onChange={function (event) { setSearch(event.target.value); }} placeholder="Name, mobile, address, area or pincode" />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                    <option value="">All</option>
                    {patientStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Sort by</label>
                  <select value={sortOrder} onChange={function (event) { setSortOrder(event.target.value); }}>
                    <option value="asc">Oldest First</option>
                    <option value="desc">Newest First</option>
                  </select>
                </div>
              </div>
              {!filtered.length ? (
                <EmptyState
                  title={resource.loading ? "Loading patients..." : "No matching patients"}
                  description="Once your care coordinators start creating patients, they will appear here with live Supabase sync."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Patient ID</th>
                        <th>Name</th>
                        <th>Age/Gender</th>
                        <th>Phone</th>
                        <th>Address</th>
                        <th>
                          <button className="table-sort-button" type="button" onClick={toggleRegisteredSort}>
                            Registered {sortOrder === "asc" ? "↑" : "↓"}
                          </button>
                        </th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(function (row) {
                        return (
                          <tr key={row.id}>
                            <td>{row.id}</td>
                            <td>
                              <div className="table-primary">{row.full_name}</div>
                              <div className="record-meta">
                                <span className={"status " + String(row.status || "").toLowerCase()}>{row.status}</span>
                                <span>{row.area}, {row.city}</span>
                              </div>
                            </td>
                            <td>{String(row.age || "-") + " / " + String(row.gender || "-")}</td>
                            <td>{row.mobile || "-"}</td>
                            <td>
                              <div className="address-clamp" title={row.address || ""}>
                                {row.address || "-"}
                              </div>
                            </td>
                            <td>{formatDate(row.registered_at || row.created_at)}</td>
                            <td>
                              <div className="button-row">
                                <button className="button secondary" type="button" onClick={function () { editPatient(row); }}>
                                  Edit
                                </button>
                                <button className="button danger" type="button" onClick={function () { deletePatient(row.id); }}>
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

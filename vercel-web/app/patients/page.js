"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useRealtimeResource } from "@/hooks/use-realtime-resource";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import {
  bloodGroupOptions,
  patientCloseReasonOptions,
  patientStatusOptions,
  shiftOptions
} from "@/lib/crm-options";
import { formatDate, slugToText } from "@/lib/formatters";
import { downloadCsv } from "@/lib/csv";
import { uploadDocument } from "@/lib/uploads";

function emptyRelative() {
  return { name: "", phone: "" };
}

function createInitialForm() {
  return {
    id: "",
    full_name: "",
    dob: "",
    age: 0,
    gender: "Female",
    blood: "Unknown",
    email: "",
    address: "",
    area: "",
    city: "Ahmedabad",
    pincode: "",
    mobile: "",
    disease_condition: "",
    assigned_staff_id: "",
    shift_type: "DAY",
    start_date: new Date().toISOString().slice(0, 10),
    status: "Active",
    status_reason: "",
    status_reason_other: "",
    photo: null,
    documents: [],
    relative_contacts: [emptyRelative(), emptyRelative(), emptyRelative()]
  };
}

function deriveAgeFromDob(dob) {
  if (!dob) return 0;
  var birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return 0;
  var now = new Date();
  var age = now.getFullYear() - birth.getFullYear();
  var m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age < 0 ? 0 : age;
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
  var [sortOrder, setSortOrder] = useState("desc");

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
          var hay = [row.full_name || row.name, row.mobile || row.phone, row.address || row.addr, row.area, row.pincode || row.pin]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          var matchesSearch = !search || hay.indexOf(search.toLowerCase()) >= 0;
          var matchesStatus = !statusFilter || row.status === statusFilter;
          return matchesSearch && matchesStatus;
        })
        .slice()
        .sort(function (left, right) {
          var leftTime = new Date(left.registered_at || left.created_at || left.created || 0).getTime();
          var rightTime = new Date(right.registered_at || right.created_at || right.created || 0).getTime();
          return sortOrder === "asc" ? leftTime - rightTime : rightTime - leftTime;
        });
    },
    [resource.data, search, statusFilter, sortOrder]
  );

  function updateField(name, value) {
    setForm(function (current) {
      var next = { ...current, [name]: value };
      if (name === "dob") {
        next.age = deriveAgeFromDob(value) || current.age;
      }
      return next;
    });
  }

  function updateContact(index, key, value) {
    setForm(function (current) {
      var next = current.relative_contacts.slice();
      next[index] = { ...next[index], [key]: value };
      return { ...current, relative_contacts: next };
    });
  }

  function exportPatientsCsv() {
    downloadCsv(
      "patients.csv",
      filtered.map(function (row) {
        return {
          patient_id: row.id,
          name: row.full_name || row.name,
          dob: row.dob || "",
          age_gender: String(row.age || "") + " / " + String(row.gender || ""),
          blood: row.blood || "",
          phone: row.mobile || row.phone || "",
          email: row.email || "",
          address: row.address || row.addr || "",
          area: row.area || "",
          city: row.city || "",
          pincode: row.pincode || row.pin || "",
          registered: row.registered_at || row.created_at || row.created || "",
          status: row.status || "",
          status_reason: row.status_reason || row.close_reason || "",
          shift_type: row.shift_type || row.shift || "",
          disease_condition: row.disease_condition || "",
          assigned_staff: row.employees?.full_name || row.caretaker_id || row.assigned_staff_id || "",
          relname1: row.relname || "",
          relphone1: row.relphone || "",
          relname2: row.relname2 || "",
          relphone2: row.relphone2 || "",
          relname3: row.relname3 || "",
          relphone3: row.relphone3 || ""
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
        return { ...current, documents: current.documents.concat(uploaded) };
      });
      setMessage("Patient documents uploaded");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload patient documents");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handlePhotoUpload(event) {
    var file = (event.target.files || [])[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      var uploaded = await uploadDocument({
        bucket: "patient-documents",
        file: file,
        session: auth.session,
        supabase: auth.supabase
      });
      setForm(function (current) {
        return { ...current, photo: uploaded };
      });
      setMessage("Patient photo uploaded");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload photo");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  function editPatient(row) {
    setError("");
    setMessage("");
    var rels = [
      { name: row.relname || "", phone: row.relphone || "" },
      { name: row.relname2 || "", phone: row.relphone2 || "" },
      { name: row.relname3 || "", phone: row.relphone3 || "" }
    ];
    if (Array.isArray(row.relative_contacts) && row.relative_contacts.length) {
      for (var i = 0; i < Math.min(3, row.relative_contacts.length); i += 1) {
        rels[i] = {
          name: row.relative_contacts[i].name || rels[i].name,
          phone: row.relative_contacts[i].phone || rels[i].phone
        };
      }
    }
    setForm({
      id: row.id,
      full_name: row.full_name || row.name || "",
      dob: row.dob || "",
      age: row.age || deriveAgeFromDob(row.dob) || 0,
      gender: row.gender || "Female",
      blood: row.blood || "Unknown",
      email: row.email || "",
      address: row.address || row.addr || "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      pincode: row.pincode || row.pin || "",
      mobile: row.mobile || row.phone || "",
      disease_condition: row.disease_condition || "",
      assigned_staff_id: row.assigned_staff_id || row.caretaker_id || "",
      shift_type: row.shift_type || row.shift || "DAY",
      start_date: row.start_date || (row.created_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      status: row.status || "Active",
      status_reason: row.status_reason || row.close_reason || "",
      status_reason_other: row.status_reason_other || row.close_reason_other || "",
      photo: row.photo && typeof row.photo === "object" ? row.photo : null,
      documents: row.patient_documents || row.docs || [],
      relative_contacts: rels
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
      if (form.status !== "Active" && !form.status_reason.trim()) {
        throw new Error("Reason is required when patient is not Active");
      }
      if (form.status_reason === "Other" && !form.status_reason_other.trim()) {
        throw new Error("Specify the other reason for " + form.status);
      }
      var payload = {
        full_name: form.full_name,
        name: form.full_name,
        dob: form.dob || "",
        age: String(form.age || ""),
        gender: form.gender,
        blood: form.blood || "",
        email: form.email || undefined,
        address: form.address || "",
        addr: form.address || "",
        area: form.area,
        city: form.city,
        pincode: form.pincode,
        pin: form.pincode,
        mobile: form.mobile,
        phone: form.mobile,
        disease_condition: form.disease_condition,
        assigned_staff_id: form.assigned_staff_id || undefined,
        caretaker_id: form.assigned_staff_id || undefined,
        shift_type: form.shift_type,
        start_date: form.start_date,
        status: form.status,
        status_reason: form.status_reason || "",
        status_reason_other: form.status_reason_other || "",
        relname: form.relative_contacts[0]?.name || "",
        relphone: form.relative_contacts[0]?.phone || "",
        relname2: form.relative_contacts[1]?.name || "",
        relphone2: form.relative_contacts[1]?.phone || "",
        relname3: form.relative_contacts[2]?.name || "",
        relphone3: form.relative_contacts[2]?.phone || "",
        relative_contacts: form.relative_contacts.filter(function (item) {
          return item.name && item.phone;
        }),
        photo: form.photo || undefined,
        docs: form.documents,
        documents: form.documents
      };
      await requestWithOfflineFallback(
        form.id ? "/patients/" + form.id : "/patients",
        { method: form.id ? "PUT" : "POST", body: payload },
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
            description="Full demographic profile with relatives, photo, docs and status workflow."
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
                  <label>Date of birth</label>
                  <input
                    type="date"
                    value={form.dob}
                    onChange={function (event) { updateField("dob", event.target.value); }}
                  />
                </div>
                <div className="field">
                  <label>Age</label>
                  <input
                    type="number"
                    min="0"
                    value={form.age}
                    onChange={function (event) { updateField("age", event.target.value); }}
                  />
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
                  <label>Blood group</label>
                  <select value={form.blood} onChange={function (event) { updateField("blood", event.target.value); }}>
                    {bloodGroupOptions.map(function (b) {
                      return <option key={b} value={b}>{b}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={function (event) { updateField("email", event.target.value); }}
                  />
                </div>
                <div className="field">
                  <label>Shift</label>
                  <select value={form.shift_type} onChange={function (event) { updateField("shift_type", event.target.value); }}>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Start date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={function (event) { updateField("start_date", event.target.value); }}
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label>Disease / condition</label>
                <textarea rows="3" value={form.disease_condition} onChange={function (event) { updateField("disease_condition", event.target.value); }} />
              </div>
              <div className="field">
                <label>Address</label>
                <textarea rows="3" maxLength="500" value={form.address} onChange={function (event) { updateField("address", event.target.value); }} />
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
                  <label>Assigned staff</label>
                  <select value={form.assigned_staff_id} onChange={function (event) { updateField("assigned_staff_id", event.target.value); }}>
                    <option value="">No assignment</option>
                    {employees.map(function (employee) {
                      return (
                        <option key={employee.id} value={employee.id}>
                          {(employee.full_name || employee.name) + (employee.role ? " (" + slugToText(employee.role) + ")" : "")}
                        </option>
                      );
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
              {form.status !== "Active" ? (
                <div className="grid-2">
                  <div className="field">
                    <label>Reason</label>
                    <select value={form.status_reason} onChange={function (event) { updateField("status_reason", event.target.value); }} required>
                      <option value="">Select reason</option>
                      {patientCloseReasonOptions.map(function (r) {
                        return <option key={r} value={r}>{r}</option>;
                      })}
                    </select>
                  </div>
                  {form.status_reason === "Other" ? (
                    <div className="field">
                      <label>Specify other reason</label>
                      <input
                        value={form.status_reason_other}
                        onChange={function (event) { updateField("status_reason_other", event.target.value); }}
                        required
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="stack">
                <strong>Relatives / emergency contacts</strong>
                {form.relative_contacts.map(function (contact, index) {
                  return (
                    <div className="grid-2" key={index}>
                      <div className="field">
                        <label>Relative {index + 1} name {index === 0 ? "*" : ""}</label>
                        <input value={contact.name} onChange={function (event) { updateContact(index, "name", event.target.value); }} required={index === 0} />
                      </div>
                      <div className="field">
                        <label>Relative {index + 1} phone {index === 0 ? "*" : ""}</label>
                        <input value={contact.phone} onChange={function (event) { updateContact(index, "phone", event.target.value); }} required={index === 0} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Patient photo</label>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} />
                  {form.photo ? <small>{form.photo.file_name || form.photo.path}</small> : <small>Optional.</small>}
                </div>
                <div className="field">
                  <label>Documents</label>
                  <input type="file" multiple onChange={handleUpload} />
                  <small>Discharge, prescriptions, IDs.</small>
                </div>
              </div>
              <div className="document-list">
                {form.documents.map(function (doc, index) {
                  return (
                    <div className="document-item" key={doc.path || index}>
                      <div>{doc.file_name || doc.path}</div>
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
                  {busy ? "Saving..." : form.id ? "Update patient" : "Create patient"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
          </ModuleShell>

          <div className="page-grid">
            <ModuleShell
              title="Patient registry"
              description="Live ledger with status filter, CSV export and click-through edit."
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
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
              </div>
              {!filtered.length ? (
                <EmptyState
                  title={resource.loading ? "Loading patients..." : "No matching patients"}
                  description="Patients appear here as soon as they are created on any device."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Age/Sex</th>
                        <th>Blood</th>
                        <th>Phone</th>
                        <th>Area</th>
                        <th>Status</th>
                        <th>Registered</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(function (row) {
                        return (
                          <tr key={row.id}>
                            <td>{row.id}</td>
                            <td>
                              <div className="table-primary">{row.full_name || row.name}</div>
                              <div className="record-meta mini-muted">
                                <span>{row.email || ""}</span>
                              </div>
                            </td>
                            <td>{String(row.age || "-") + " / " + String(row.gender || "-")}</td>
                            <td>{row.blood || "-"}</td>
                            <td>{row.mobile || row.phone || "-"}</td>
                            <td>{(row.area || "-") + ", " + (row.city || "")}</td>
                            <td>
                              <span className={"status " + String(row.status || "").toLowerCase()}>{row.status}</span>
                              {row.status_reason || row.close_reason ? (
                                <div className="mini-muted">{row.status_reason || row.close_reason}</div>
                              ) : null}
                            </td>
                            <td>{formatDate(row.registered_at || row.created_at || row.created)}</td>
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

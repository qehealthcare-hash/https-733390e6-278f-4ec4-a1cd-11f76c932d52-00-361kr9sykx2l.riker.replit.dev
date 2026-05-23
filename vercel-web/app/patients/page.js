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
  patientCloseReasonOptions,
  patientStatusOptions,
  shiftOptions
} from "@/lib/crm-options";
import { formatDate, slugToText } from "@/lib/formatters";
import { downloadCsv } from "@/lib/csv";
import { uploadDocument } from "@/lib/uploads";
import { CameraCaptureModal } from "@/components/ui/camera-capture";

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
    relative_contacts: [emptyRelative(), emptyRelative(), emptyRelative()],
    expected_updated_at: ""
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
  var [search, setSearch] = useState("");
  var [debouncedSearch, setDebouncedSearch] = useState("");
  var [pageSize, setPageSize] = useState(500);

  useEffect(
    function () {
      var handle = setTimeout(function () {
        setDebouncedSearch(search.trim());
      }, 300);
      return function () { clearTimeout(handle); };
    },
    [search]
  );

  var apiPath = useMemo(
    function () {
      var params = ["limit=" + pageSize];
      if (debouncedSearch) params.push("q=" + encodeURIComponent(debouncedSearch));
      return "/patients?" + params.join("&");
    },
    [debouncedSearch, pageSize]
  );

  var resource = useRealtimeResource({
    apiPath: apiPath,
    table: "hh_patients",
    channel: "hh_patients"
  });
  var [employees, setEmployees] = useState([]);
  var [form, setForm] = useState(createInitialForm());
  var [busy, setBusy] = useState(false);
  var [message, setMessage] = useState("");
  var [error, setError] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [genderFilter, setGenderFilter] = useState("");
  var [areaFilter, setAreaFilter] = useState("");
  var [pinFilter, setPinFilter] = useState("");
  var [shiftFilter, setShiftFilter] = useState("");
  var [sortOrder, setSortOrder] = useState("desc");

  // Inline modals: close-reason dialog and full patient history viewer.
  var [closeDialog, setCloseDialog] = useState(null); // { id, name, reason, reason_other }
  var [reopenDialog, setReopenDialog] = useState(null); // { id, name, note }
  var [historyDialog, setHistoryDialog] = useState(null); // { id, name }
  var [cameraOpen, setCameraOpen] = useState(false);
  var [historyData, setHistoryData] = useState(null);
  var [historyLoading, setHistoryLoading] = useState(false);
  var [historyError, setHistoryError] = useState("");

  var isAdmin = String(auth.profile?.role || "").trim().toUpperCase() === "ADMIN";

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      request("/lookups/employees", null, auth.session)
        .then(setEmployees)
        .catch(function (lookupError) {
          setEmployees([]);
          setError(
            "Could not load the employee list — " +
              (lookupError.message || "unknown error") +
              ". Assignment lists may be incomplete."
          );
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
          var matchesSearch = !debouncedSearch || hay.indexOf(debouncedSearch.toLowerCase()) >= 0;
          var matchesStatus = !statusFilter || row.status === statusFilter;
          var matchesGender = !genderFilter || row.gender === genderFilter;
          var matchesArea =
            !areaFilter ||
            String(row.area || "").toLowerCase().indexOf(areaFilter.toLowerCase()) >= 0;
          var matchesPin =
            !pinFilter ||
            String(row.pincode || row.pin || "").indexOf(pinFilter) >= 0;
          var matchesShift = !shiftFilter || (row.shift_type || row.shift) === shiftFilter;
          return (
            matchesSearch &&
            matchesStatus &&
            matchesGender &&
            matchesArea &&
            matchesPin &&
            matchesShift
          );
        })
        .slice()
        .sort(function (left, right) {
          var leftTime = new Date(left.registered_at || left.created_at || left.created || 0).getTime();
          var rightTime = new Date(right.registered_at || right.created_at || right.created || 0).getTime();
          return sortOrder === "asc" ? leftTime - rightTime : rightTime - leftTime;
        });
    },
    [resource.data, debouncedSearch, statusFilter, genderFilter, areaFilter, pinFilter, shiftFilter, sortOrder]
  );

  function caretakerLabel(employeeId) {
    if (!employeeId) return "";
    var hit = employees.find(function (employee) {
      return employee.id === employeeId;
    });
    return hit ? (hit.full_name || hit.name || employeeId) : employeeId;
  }

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
          phone: row.mobile || row.phone || "",
          address: row.address || row.addr || "",
          area: row.area || "",
          city: row.city || "",
          pincode: row.pincode || row.pin || "",
          registered: row.registered_at || row.created_at || row.created || "",
          status: row.status || "",
          status_reason: row.status_reason || row.close_reason || "",
          shift_type: row.shift_type || row.shift || "",
          disease_condition: row.disease_condition || "",
          assigned_staff: caretakerLabel(row.caretaker_id || row.assigned_staff_id),
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

  async function uploadPhotoFile(file) {
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
      setForm(function (current) { return { ...current, photo: uploaded }; });
      setMessage("Patient photo uploaded");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload photo");
    } finally {
      setBusy(false);
    }
  }

  async function handlePhotoUpload(event) {
    var file = (event.target.files || [])[0];
    event.target.value = "";
    await uploadPhotoFile(file);
  }

  async function handleCameraCapture(file) {
    setCameraOpen(false);
    await uploadPhotoFile(file);
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
      relative_contacts: rels,
      expected_updated_at: row.updated_at || ""
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
      if (form.id && form.expected_updated_at) {
        payload.expected_updated_at = form.expected_updated_at;
      }
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

  function isActiveStatus(status) {
    return String(status || "Active") === "Active";
  }

  function isRegistryClosed(status) {
    return String(status || "") === "Closed";
  }

  function openCloseDialog(row) {
    setError("");
    setMessage("");
    setCloseDialog({
      id: row.id,
      name: row.full_name || row.name || row.id,
      reason: "",
      reason_other: ""
    });
  }

  async function submitCloseDialog() {
    if (!closeDialog) return;
    if (!closeDialog.reason) {
      setError("Pick a reason to close this patient");
      return;
    }
    if (closeDialog.reason === "Other" && !closeDialog.reason_other.trim()) {
      setError("Specify the other reason");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        "/patients/" + closeDialog.id,
        {
          method: "DELETE",
          body: { reason: closeDialog.reason, reason_other: closeDialog.reason_other }
        },
        auth.session
      );
      await resource.reload();
      if (form.id === closeDialog.id) resetForm();
      setMessage("Patient closed");
      setCloseDialog(null);
    } catch (closeError) {
      setError(closeError.message || "Unable to close patient");
    } finally {
      setBusy(false);
    }
  }

  function openReopenDialog(row) {
    setError("");
    setMessage("");
    setReopenDialog({
      id: row.id,
      name: row.full_name || row.name || row.id,
      note: ""
    });
  }

  async function submitReopenDialog() {
    if (!reopenDialog) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        "/patients/" + reopenDialog.id + "/reopen",
        {
          method: "POST",
          body: reopenDialog.note.trim()
            ? { reason: reopenDialog.note.trim() }
            : undefined
        },
        auth.session
      );
      await resource.reload();
      if (form.id === reopenDialog.id) resetForm();
      setMessage("Patient reopened");
      setReopenDialog(null);
    } catch (reopenError) {
      setError(reopenError.message || "Unable to reopen patient");
    } finally {
      setBusy(false);
    }
  }

  async function deletePatientPermanently(id) {
    if (!isAdmin) {
      setError("Only an Admin can permanently delete patients.");
      return;
    }
    if (
      !window.confirm(
        "Permanently delete this patient? This cannot be undone. " +
          "If the patient has any billings, duties, or receipts, the delete will be refused."
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestWithOfflineFallback(
        "/patients/" + id + "?hard=1",
        { method: "DELETE" },
        auth.session
      );
      await resource.reload();
      if (form.id === id) resetForm();
      setMessage("Patient permanently deleted");
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete patient");
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(row) {
    setHistoryDialog({ id: row.id, name: row.full_name || row.name || row.id });
    setHistoryData(null);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      var bundle = await request("/patients/" + row.id + "/history", null, auth.session);
      setHistoryData(bundle);
    } catch (historyErr) {
      setHistoryError(historyErr.message || "Could not load patient history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryDialog(null);
    setHistoryData(null);
    setHistoryError("");
    setHistoryLoading(false);
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
                  <div className="button-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoUpload}
                    />
                    <button
                      type="button"
                      className="button ghost"
                      onClick={function () { setCameraOpen(true); }}
                    >
                      Use camera
                    </button>
                  </div>
                  {form.photo
                    ? <small>{form.photo.file_name || form.photo.path}</small>
                    : <small>Optional. On mobile the file picker also opens the camera.</small>}
                </div>
                <div className="field">
                  <label>Documents</label>
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleUpload}
                  />
                  <small>Discharge, prescriptions, IDs. JPG/PNG/HEIC/PDF up to 25 MB each.</small>
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
              {!error && resource.error ? (
                <div className="error-text">Live patient list error — {resource.error}</div>
              ) : null}
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
                  <input
                    value={search}
                    onChange={function (event) { setSearch(event.target.value); }}
                    placeholder="Name, mobile, address, area or pincode"
                  />
                </div>
                <div className="field">
                  <label>Rows per page</label>
                  <select
                    value={String(pageSize)}
                    onChange={function (event) { setPageSize(parseInt(event.target.value, 10) || 500); }}
                  >
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="500">All (up to 500)</option>
                  </select>
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
                  <label>Gender</label>
                  <select value={genderFilter} onChange={function (event) { setGenderFilter(event.target.value); }}>
                    <option value="">All</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label>Shift</label>
                  <select value={shiftFilter} onChange={function (event) { setShiftFilter(event.target.value); }}>
                    <option value="">All</option>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Area</label>
                  <input
                    value={areaFilter}
                    onChange={function (event) { setAreaFilter(event.target.value); }}
                    placeholder="e.g. Naranpura"
                  />
                </div>
                <div className="field">
                  <label>Pincode</label>
                  <input
                    value={pinFilter}
                    onChange={function (event) { setPinFilter(event.target.value); }}
                    placeholder="e.g. 380013"
                    inputMode="numeric"
                  />
                </div>
                <div className="field">
                  <label>Sort by</label>
                  <select value={sortOrder} onChange={function (event) { setSortOrder(event.target.value); }}>
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
              </div>
              <div className="mini-muted" style={{ margin: "0.25rem 0 0.75rem" }}>
                {debouncedSearch
                  ? "Server search: \"" + debouncedSearch + "\" — "
                  : ""}
                Showing {filtered.length} of {resource.data.length} loaded
                {resource.loading ? " (loading...)" : ""}
              </div>
              {!filtered.length ? (
                <EmptyState
                  title={resource.loading ? "Loading patients..." : "No matching patients"}
                  description={
                    debouncedSearch
                      ? "No patient matches \"" + debouncedSearch + "\". Try fewer characters or a phone suffix."
                      : "Patients appear here as soon as they are created on any device."
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Age/Sex</th>
                        <th>Phone</th>
                        <th>Area</th>
                        <th>Status</th>
                        <th>Registered</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(function (row, index) {
                        return (
                          <tr key={row.id}>
                            <td>{index + 1}</td>
                            <td>{row.id}</td>
                            <td>
                              <div className="table-primary">{row.full_name || row.name}</div>
                            </td>
                            <td>{String(row.age || "-") + " / " + String(row.gender || "-")}</td>
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
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={function () { openHistory(row); }}
                                  disabled={busy}
                                >
                                  History
                                </button>
                                {!isRegistryClosed(row.status) ? (
                                  <button
                                    className="button secondary"
                                    type="button"
                                    onClick={function () { editPatient(row); }}
                                    disabled={busy}
                                  >
                                    Edit
                                  </button>
                                ) : null}
                                {!isActiveStatus(row.status) ? (
                                  <>
                                    <button
                                      className="button secondary"
                                      type="button"
                                      onClick={function () { openReopenDialog(row); }}
                                      disabled={busy}
                                    >
                                      Reopen
                                    </button>
                                    {isAdmin && isRegistryClosed(row.status) ? (
                                      <button
                                        className="button danger"
                                        type="button"
                                        onClick={function () { deletePatientPermanently(row.id); }}
                                        disabled={busy}
                                        title="Permanent delete (Admin only). Refused if linked billings, duties, or receipts exist."
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </>
                                ) : (
                                  <button
                                    className="button danger"
                                    type="button"
                                    onClick={function () { openCloseDialog(row); }}
                                    disabled={busy}
                                  >
                                    Close
                                  </button>
                                )}
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
          {closeDialog ? (
            <div className="modal-backdrop" onClick={function (event) {
              if (event.target === event.currentTarget && !busy) setCloseDialog(null);
            }}>
              <div className="panel modal-card" role="dialog" aria-modal="true">
                <h3>Close patient: {closeDialog.name}</h3>
                <p className="mini-muted">
                  Soft-close keeps all billings, duties and receipts. Pick a reason — it is
                  recorded in the audit log.
                </p>
                <div className="field">
                  <label>Reason</label>
                  <select
                    value={closeDialog.reason}
                    onChange={function (event) {
                      var value = event.target.value;
                      setCloseDialog(function (d) {
                        return d ? { ...d, reason: value } : d;
                      });
                    }}
                    required
                  >
                    <option value="">Select reason</option>
                    {patientCloseReasonOptions.map(function (r) {
                      return <option key={r} value={r}>{r}</option>;
                    })}
                  </select>
                </div>
                {closeDialog.reason === "Other" ? (
                  <div className="field">
                    <label>Specify other reason</label>
                    <input
                      value={closeDialog.reason_other}
                      onChange={function (event) {
                        var value = event.target.value;
                        setCloseDialog(function (d) {
                          return d ? { ...d, reason_other: value } : d;
                        });
                      }}
                      maxLength={500}
                    />
                  </div>
                ) : null}
                {error ? <div className="error-text">{error}</div> : null}
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={function () { setCloseDialog(null); }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    onClick={submitCloseDialog}
                    disabled={busy}
                  >
                    {busy ? "Closing..." : "Close patient"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {reopenDialog ? (
            <div className="modal-backdrop" onClick={function (event) {
              if (event.target === event.currentTarget && !busy) setReopenDialog(null);
            }}>
              <div className="panel modal-card" role="dialog" aria-modal="true">
                <h3>Reopen patient: {reopenDialog.name}</h3>
                <p className="mini-muted">
                  Status will return to Active. If another active patient already uses this
                  mobile number, reopen will be refused.
                </p>
                <div className="field">
                  <label>Note (optional, for your records)</label>
                  <textarea
                    rows="2"
                    value={reopenDialog.note}
                    onChange={function (event) {
                      var value = event.target.value;
                      setReopenDialog(function (d) {
                        return d ? { ...d, note: value } : d;
                      });
                    }}
                    maxLength={500}
                    placeholder="e.g. Returned from hospital"
                  />
                </div>
                {error ? <div className="error-text">{error}</div> : null}
                <div className="button-row">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={function () { setReopenDialog(null); }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    className="button primary"
                    type="button"
                    onClick={submitReopenDialog}
                    disabled={busy}
                  >
                    {busy ? "Reopening..." : "Reopen as Active"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {historyDialog ? (
            <div className="modal-backdrop" onClick={function (event) {
              if (event.target === event.currentTarget) closeHistory();
            }}>
              <div className="panel modal-card modal-wide" role="dialog" aria-modal="true">
                <div className="modal-head">
                  <h3>History — {historyDialog.name}</h3>
                  <button className="button ghost" type="button" onClick={closeHistory}>Close</button>
                </div>
                {historyLoading ? <p>Loading patient ledger...</p> : null}
                {historyError ? <div className="error-text">{historyError}</div> : null}
                {historyData ? (
                  <div className="stack">
                    <div className="mini-muted">
                      Patient ID: {historyData.patient?.id || historyDialog.id}
                      {" · "}Status: {historyData.patient?.status || "—"}
                      {" · "}Billings: {historyData.linkCounts?.billings ?? 0}
                      {" · "}Duties: {historyData.linkCounts?.duties ?? 0}
                    </div>
                    <div>
                      <h4>Billings ({(historyData.billings || []).length})</h4>
                      {historyData.billings && historyData.billings.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>ID</th><th>Status</th><th>Total</th><th>Created</th></tr>
                            </thead>
                            <tbody>
                              {historyData.billings.map(function (b) {
                                return (
                                  <tr key={b.id}>
                                    <td>{b.id}</td>
                                    <td>{b.status || "—"}</td>
                                    <td>{b.total ?? b.amount ?? "—"}</td>
                                    <td>{formatDate(b.created_at || b.created)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No billings.</p>}
                    </div>
                    <div>
                      <h4>Duties ({(historyData.duties || []).length})</h4>
                      {historyData.duties && historyData.duties.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>ID</th><th>Employee</th><th>Shift</th><th>Status</th><th>Start</th></tr>
                            </thead>
                            <tbody>
                              {historyData.duties.map(function (d) {
                                return (
                                  <tr key={d.id}>
                                    <td>{d.id}</td>
                                    <td>{d.employee_id || d.caretaker_id || "—"}</td>
                                    <td>{d.shift || d.shift_type || "—"}</td>
                                    <td>{d.status || "—"}</td>
                                    <td>{formatDate(d.start_at || d.start_date || d.created_at)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No duties.</p>}
                    </div>
                    <div>
                      <h4>Receipts ({(historyData.receipts || []).length})</h4>
                      {historyData.receipts && historyData.receipts.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>ID</th><th>Billing</th><th>Method</th><th>Amount</th><th>Created</th></tr>
                            </thead>
                            <tbody>
                              {historyData.receipts.map(function (r) {
                                return (
                                  <tr key={r.id}>
                                    <td>{r.id}</td>
                                    <td>{r.billing_id}</td>
                                    <td>{r.method || "—"}</td>
                                    <td>{r.amount ?? "—"}</td>
                                    <td>{formatDate(r.created_at || r.created)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No receipts.</p>}
                    </div>
                    <div>
                      <h4>Audit trail ({(historyData.audits || []).length})</h4>
                      {historyData.audits && historyData.audits.length ? (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr><th>When</th><th>Actor</th><th>Action</th><th>Note</th></tr>
                            </thead>
                            <tbody>
                              {historyData.audits.map(function (a) {
                                return (
                                  <tr key={a.id}>
                                    <td>{formatDate(a.created_at)}</td>
                                    <td>{a.actor || a.user_id || "—"}</td>
                                    <td>{a.action || "—"}</td>
                                    <td>{a.stamp || ""}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : <p className="mini-muted">No audit entries.</p>}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </AppShell>

      <CameraCaptureModal
        open={cameraOpen}
        onClose={function () { setCameraOpen(false); }}
        onCapture={handleCameraCapture}
        facingMode="environment"
      />
    </AuthGuard>
  );
}

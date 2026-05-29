"use client";

/**
 * Patients / client registry (M5 Pass D — TypeScript).
 *
 * Presentation-only: all writes go through `/api/v1/patients/*`. PDF helpers
 * live in `@/lib/patientUi`.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { usePaginatedResource } from "@/hooks/use-paginated-resource";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { useAuth } from "@/components/providers/auth-provider";
import { patientsClient, lookupsClient } from "@/lib/clients";
import {
  patientCloseReasonOptions,
  patientStatusOptions,
  shiftOptions
} from "@/lib/crm-options";
import { formatDate, slugToText } from "@/lib/formatters";
import { crmTodayIso } from "@/src/utils/crmToday";
import { downloadCsv } from "@/lib/csv";
import { openPrintWindow } from "@/lib/print";
import { uploadDocument, getDocumentSignedUrl } from "@/lib/uploads";
import { CameraCaptureModal } from "@/components/ui/camera-capture-lazy";
import { DocumentCard, DocumentList } from "@/components/ui/document-card";
import { hasPermission } from "@/lib/permissions";
import {
  PATIENT_CLOSE_ROLES,
  PATIENT_HISTORY_ROLES,
  type Role
} from "@/business/rbac";
import {
  buildPatientPdfBody,
  patientDisplayName,
  patientListPosition,
  type PatientDocRef,
  type PatientListRow
} from "@/lib/patientUi";

interface RelativeContact {
  name: string;
  phone: string;
}

interface PatientFormState {
  id: string;
  full_name: string;
  dob: string;
  age: number | string;
  gender: string;
  address: string;
  area: string;
  city: string;
  pincode: string;
  mobile: string;
  disease_condition: string;
  assigned_staff_id: string;
  shift_type: string;
  start_date: string;
  status: string;
  status_reason: string;
  status_reason_other: string;
  photo: PatientDocRef | null;
  documents: PatientDocRef[];
  relative_contacts: RelativeContact[];
  expected_updated_at: string;
  confirm_duplicate_name: boolean;
  aadhar?: string;
}

function roleInList(role: unknown, list: readonly Role[]): boolean {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  return list.some((r) => r.toLowerCase() === normalized);
}

function emptyRelative() {
  return { name: "", phone: "" };
}

function createInitialForm(): PatientFormState {
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
    expected_updated_at: "",
    confirm_duplicate_name: false
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
  const auth = useAuth();
  const accessToken = auth.session?.access_token ?? "";
  const canWrite = hasPermission(auth.profile?.role, "patients.write");
  const canClose = roleInList(auth.profile?.role, PATIENT_CLOSE_ROLES);
  const canViewHistory = roleInList(auth.profile?.role, PATIENT_HISTORY_ROLES);
  var [search, setSearch] = useState("");
  var [debouncedSearch, setDebouncedSearch] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [genderFilter, setGenderFilter] = useState("");
  var [areaFilter, setAreaFilter] = useState("");
  var [pinFilter, setPinFilter] = useState("");
  var [shiftFilter, setShiftFilter] = useState("");
  var [sortOrder, setSortOrder] = useState("desc");
  useEffect(
    function () {
      var handle = setTimeout(function () {
        setDebouncedSearch(search.trim());
      }, 300);
      return function () { clearTimeout(handle); };
    },
    [search]
  );

  var listQuery = useMemo(
    function () {
      return {
        q: debouncedSearch || undefined,
        status: statusFilter || undefined,
        gender: genderFilter || undefined,
        area: areaFilter || undefined,
        pin: pinFilter || undefined,
        shift: shiftFilter || undefined
      };
    },
    [debouncedSearch, statusFilter, genderFilter, areaFilter, pinFilter, shiftFilter]
  );

  var resource = usePaginatedResource({
    basePath: patientsClient.basePath,
    table: "hh_patients",
    channel: "hh_patients",
    queryParams: listQuery,
    resetKey:
      debouncedSearch +
      "|" +
      statusFilter +
      "|" +
      genderFilter +
      "|" +
      areaFilter +
      "|" +
      pinFilter +
      "|" +
      shiftFilter,
    pageSize: 50
  });
  var [employees, setEmployees] = useState([]);
  var [form, setForm] = useState(createInitialForm());
  // P1-36: stable per-form-session resource id for uploads that happen
  // BEFORE the patient is persisted (new-patient flow). Once form.id
  // exists we prefer that; otherwise this draft-id keeps every file
  // attached to a single patient form clustered under the same prefix.
  var draftIdRef = useRef(
    "draft-" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36))
  );
  var [busy, setBusy] = useState(false);
  var [message, setMessage] = useState("");
  var [error, setError] = useState("");
  var [conflictPrompt, setConflictPrompt] = useState(null); // { actual, action }
  var [duplicatePrompt, setDuplicatePrompt] = useState(null); // { message }
  // Inline modals: close-reason dialog and full patient history viewer.
  var [closeDialog, setCloseDialog] = useState(null); // { id, name, reason, reason_other }
  var [reopenDialog, setReopenDialog] = useState(null); // { id, name, note }
  var [historyDialog, setHistoryDialog] = useState(null); // { id, name }
  var [cameraOpen, setCameraOpen] = useState(false);
  var [historyData, setHistoryData] = useState(null);
  var [historyLoading, setHistoryLoading] = useState(false);
  var [historyError, setHistoryError] = useState("");

  const isAdmin = String(auth.profile?.role || "").trim().toUpperCase() === "ADMIN";

  useEffect(
    function () {
      if (!accessToken) return;
      let cancelled = false;
      lookupsClient
        .employees(auth.session)
        .then(function (rows) {
          if (!cancelled) setEmployees(rows);
        })
        .catch(function (lookupError: unknown) {
          if (cancelled) return;
          setEmployees([]);
          const msg =
            lookupError &&
            typeof lookupError === "object" &&
            "message" in lookupError &&
            typeof (lookupError as { message?: unknown }).message === "string"
              ? (lookupError as { message: string }).message
              : "unknown error";
          setError(
            "Could not load the employee list — " + msg + ". Assignment lists may be incomplete."
          );
        });
      return function () {
        cancelled = true;
      };
    },
    [accessToken, auth.session]
  );

  var rows = useMemo(
    function () {
      return resource.data
        .slice()
        .sort(function (left, right) {
          var leftTime = new Date(left.registered_at || left.created_at || left.created || 0).getTime();
          var rightTime = new Date(right.registered_at || right.created_at || right.created || 0).getTime();
          return sortOrder === "asc" ? leftTime - rightTime : rightTime - leftTime;
        });
    },
    [resource.data, sortOrder]
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
      rows.map(function (row) {
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
      var patientResourceId = form.id || draftIdRef.current;
      for (var i = 0; i < files.length; i += 1) {
        uploaded.push(
          await uploadDocument({
            bucket: "patient-documents",
            file: files[i],
            session: auth.session,
            supabase: auth.supabase,
            resource: "Patients",
            resourceId: patientResourceId
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
        supabase: auth.supabase,
        resource: "Patients",
        resourceId: form.id || draftIdRef.current
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

  function editPatient(row: PatientListRow) {
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
      expected_updated_at: row.updated_at || "",
      confirm_duplicate_name: false
    });
    if (!row.updated_at) {
      setMessage(
        "Loaded a legacy patient without a last-modified timestamp — concurrent edit detection is disabled for this record. Save with care."
      );
    }
  }

  function resetForm() {
    setForm(createInitialForm());
    setError("");
    setMessage("");
  }

  async function submitForm(formOverride?: PatientFormState) {
    const current = formOverride ?? form;
    setBusy(true);
    setError("");
    setMessage("");
    setConflictPrompt(null);
    setDuplicatePrompt(null);
    try {
      if (current.status !== "Active" && !current.id && !current.status_reason.trim()) {
        throw new Error("Reason is required when patient is not Active");
      }
      if (current.status_reason === "Other" && !current.status_reason_other.trim()) {
        throw new Error("Specify the other reason for " + current.status);
      }
      const payload: Record<string, unknown> = {
        id: current.id || undefined,
        full_name: current.full_name,
        name: current.full_name,
        dob: current.dob || "",
        age: String(current.age || ""),
        gender: current.gender,
        address: current.address || "",
        addr: current.address || "",
        area: current.area,
        city: current.city,
        pincode: current.pincode,
        pin: current.pincode,
        mobile: current.mobile,
        phone: current.mobile,
        disease_condition: current.disease_condition,
        assigned_staff_id: current.assigned_staff_id || undefined,
        caretaker_id: current.assigned_staff_id || undefined,
        shift_type: current.shift_type,
        start_date: current.start_date,
        status: current.status,
        status_reason: current.status_reason || "",
        status_reason_other: current.status_reason_other || "",
        relname: current.relative_contacts[0]?.name || "",
        relphone: current.relative_contacts[0]?.phone || "",
        relname2: current.relative_contacts[1]?.name || "",
        relphone2: current.relative_contacts[1]?.phone || "",
        relname3: current.relative_contacts[2]?.name || "",
        relphone3: current.relative_contacts[2]?.phone || "",
        relative_contacts: current.relative_contacts.filter(function (item) {
          return item.name && item.phone;
        }),
        photo: current.photo || undefined,
        docs: current.documents,
        documents: current.documents
      };
      if (current.id && current.expected_updated_at) {
        payload.expected_updated_at = current.expected_updated_at;
      }
      if (current.confirm_duplicate_name) {
        payload.confirm_duplicate_name = true;
      }
      await patientsClient.save(auth.session, payload);
      await resource.reload();
      resetForm();
      setMessage(current.id ? "Patient updated successfully" : "Patient created successfully");
    } catch (submitError: unknown) {
      const err = submitError as {
        code?: string;
        message?: string;
        details?: { actual_updated_at?: string; field?: string };
      };
      const code = err?.code;
      if (code === "conflict") {
        setConflictPrompt({
          actual: err?.details?.actual_updated_at,
          message:
            err.message ||
            "Patient was modified by another user — reload to see their changes."
        });
      } else if (code === "duplicate" && err?.details?.field === "name" && !current.id) {
        setDuplicatePrompt({
          message: err.message || "An active patient with this name already exists."
        });
      } else {
        setError(err.message || "Unable to save patient");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      setError("You do not have permission to create or edit patients.");
      return;
    }
    return submitForm();
  }

  async function reloadPatientFromConflict() {
    if (!form.id) {
      setConflictPrompt(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      var fresh = await patientsClient.get(auth.session, form.id);
      editPatient(fresh);
      setConflictPrompt(null);
      setMessage("Patient reloaded — your previous edits were discarded.");
    } catch (reloadError) {
      setError(reloadError.message || "Could not reload patient.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDuplicateAndResubmit() {
    setDuplicatePrompt(null);
    const next = { ...form, confirm_duplicate_name: true };
    setForm(next);
    await submitForm(next);
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
      await patientsClient.close(auth.session, closeDialog.id, {
        reason: closeDialog.reason,
        reason_other: closeDialog.reason_other
      });
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
      await patientsClient.reopen(
        auth.session,
        reopenDialog.id,
        reopenDialog.note.trim() ? { reason: reopenDialog.note.trim() } : {}
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
      await patientsClient.hardDelete(auth.session, id);
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
      var bundle = await patientsClient.history(auth.session, row.id);
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

  async function resolvePatientDocLinks(docs) {
    if (!Array.isArray(docs) || !docs.length || !auth.session) return [];
    var resolved = [];
    for (var i = 0; i < docs.length; i += 1) {
      var d = docs[i];
      try {
        var data = await getDocumentSignedUrl(d, auth.session, { expiresIn: 1800 });
        resolved.push({ ...d, signedUrl: data && data.signedUrl ? data.signedUrl : "" });
      } catch (_e) {
        resolved.push({ ...d, signedUrl: "" });
      }
    }
    return resolved;
  }

  async function openPatientPdf(row: PatientListRow, hideSensitive: boolean) {
    const preOpened = window.open("about:blank", "_blank", "width=1024,height=820");
    if (preOpened && preOpened.document) {
      try {
        preOpened.document.write(
          "<title>Preparing PDF…</title><body style='font-family:Segoe UI,Arial,sans-serif;padding:32px;color:#475569'>Loading patient profile…</body>"
        );
      } catch {
        /* ignore opaque about:blank */
      }
    }
    const rawDocs = row.patient_documents || row.docs || [];
    const photoDoc =
      row.photo && typeof row.photo === "object" && row.photo.path ? row.photo : null;
    const resolvedDocs = await resolvePatientDocLinks(rawDocs);
    const resolvedPhoto = photoDoc ? (await resolvePatientDocLinks([photoDoc]))[0] : null;
    const body = buildPatientPdfBody(
      row,
      hideSensitive,
      resolvedDocs,
      resolvedPhoto,
      caretakerLabel(row.caretaker_id || row.assigned_staff_id || "")
    );
    openPrintWindow(
      hideSensitive
        ? "Patient Profile (sanitised)"
        : "Patient Profile - " + patientDisplayName(row),
      body,
      preOpened
    );
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
                  <label htmlFor="patients-name-1">Name</label>
                  <input id="patients-name-1" value={form.full_name} onChange={function (event) { updateField("full_name", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-mobile-2">Mobile</label>
                  <input id="patients-mobile-2" type="tel" inputMode="tel" value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-date-of-birth-3">Date of birth</label>
                  <input id="patients-date-of-birth-3"
                    type="date"
                    max={crmTodayIso()}
                    value={form.dob}
                    onChange={function (event) { updateField("dob", event.target.value); }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-aadhar-4">Aadhar</label>
                  <input id="patients-aadhar-4"
                    value={form.aadhar || ""}
                    onChange={function (event) { updateField("aadhar", event.target.value); }}
                    pattern="\d{12}"
                    maxLength={12}
                    inputMode="numeric"
                    placeholder="123456789012"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-age-5">Age</label>
                  <input id="patients-age-5"
                    type="number"
                    min="0"
                    value={form.age}
                    onChange={function (event) { updateField("age", event.target.value); }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-gender-6">Gender</label>
                  <select id="patients-gender-6" value={form.gender} onChange={function (event) { updateField("gender", event.target.value); }}>
                    <option>Female</option>
                    <option>Male</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-shift-7">Shift</label>
                  <select id="patients-shift-7" value={form.shift_type} onChange={function (event) { updateField("shift_type", event.target.value); }}>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-start-date-8">Start date</label>
                  <input id="patients-start-date-8"
                    type="date"
                    value={form.start_date}
                    onChange={function (event) { updateField("start_date", event.target.value); }}
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="patients-disease-condition-9">Disease / condition</label>
                <textarea id="patients-disease-condition-9" rows="3" value={form.disease_condition} onChange={function (event) { updateField("disease_condition", event.target.value); }} />
              </div>
              <div className="field">
                <label htmlFor="patients-address-10">Address</label>
                <textarea id="patients-address-10" rows="3" maxLength="500" value={form.address} onChange={function (event) { updateField("address", event.target.value); }} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="patients-area-11">Area</label>
                  <input id="patients-area-11" value={form.area} onChange={function (event) { updateField("area", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-city-12">City</label>
                  <input id="patients-city-12" value={form.city} onChange={function (event) { updateField("city", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="patients-pincode-13">Pincode</label>
                  <input id="patients-pincode-13" value={form.pincode} onChange={function (event) { updateField("pincode", event.target.value); }} required />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="patients-assigned-staff-14">Assigned staff</label>
                  <select id="patients-assigned-staff-14" value={form.assigned_staff_id} onChange={function (event) { updateField("assigned_staff_id", event.target.value); }}>
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
                  <label htmlFor="patients-status-15">Status</label>
                  <select
                    id="patients-status-15"
                    value={form.status}
                    onChange={function (event) { updateField("status", event.target.value); }}
                    disabled={Boolean(form.id)}
                    title={
                      form.id
                        ? "Use Close or Reopen on the registry — status changes run the cascade workflow."
                        : undefined
                    }
                  >
                    {patientStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                  {form.id ? (
                    <small className="mini-muted" style={{ marginTop: 4, display: "block" }}>
                      Status changes use Close or Reopen on the patient registry (not this form).
                    </small>
                  ) : null}
                </div>
              </div>
              {form.status !== "Active" ? (
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="patients-reason-16">Reason</label>
                    <select id="patients-reason-16" value={form.status_reason} onChange={function (event) { updateField("status_reason", event.target.value); }} required>
                      <option value="">Select reason</option>
                      {patientCloseReasonOptions.map(function (r) {
                        return <option key={r} value={r}>{r}</option>;
                      })}
                    </select>
                  </div>
                  {form.status_reason === "Other" ? (
                    <div className="field">
                      <label htmlFor="patients-specify-other-reason-17">Specify other reason</label>
                      <input id="patients-specify-other-reason-17"
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
                        <label htmlFor="patients-relative-index-1-name-in-18">Relative {index + 1} name {index === 0 ? "*" : ""}</label>
                        <input id="patients-relative-index-1-name-in-18" value={contact.name} onChange={function (event) { updateContact(index, "name", event.target.value); }} required={index === 0} />
                      </div>
                      <div className="field">
                        <label htmlFor="patients-relative-index-1-phone-i-19">Relative {index + 1} phone {index === 0 ? "*" : ""}</label>
                        <input id="patients-relative-index-1-phone-i-19" type="tel" inputMode="tel" value={contact.phone} onChange={function (event) { updateContact(index, "phone", event.target.value); }} required={index === 0} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="patients-patient-photo-20">Patient photo</label>
                  <div className="button-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input id="patients-patient-photo-20"
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
                  {form.photo ? (
                    <div style={{ marginTop: 8 }}>
                      <DocumentCard doc={form.photo} session={auth.session} />
                    </div>
                  ) : (
                    <small>Optional. On mobile the file picker also opens the camera.</small>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="patients-documents-form-documents-21">Documents ({form.documents.length})</label>
                  <input id="patients-documents-form-documents-21"
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleUpload}
                  />
                  <small>Discharge, prescriptions, IDs. JPG/PNG/HEIC/PDF up to 25 MB each.</small>
                </div>
              </div>
              <DocumentList
                docs={form.documents}
                session={auth.session}
                onRemove={function (doc) {
                  setForm(function (current) {
                    return {
                      ...current,
                      documents: current.documents.filter(function (item) {
                        return item.path !== doc.path;
                      })
                    };
                  });
                }}
              />
              {conflictPrompt ? (
                <div
                  className="error-text"
                  style={{
                    border: "1px solid var(--warn, #d97706)",
                    background: "rgba(217,119,6,0.08)",
                    padding: "10px 12px",
                    borderRadius: 6
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    <strong>Concurrent edit detected.</strong> {conflictPrompt.message}
                    {conflictPrompt.actual ? (
                      <span className="mini-muted">
                        {" "}(server updated_at: {String(conflictPrompt.actual)})
                      </span>
                    ) : null}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button
                      className="button primary"
                      type="button"
                      onClick={reloadPatientFromConflict}
                      disabled={busy}
                    >
                      Reload latest
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={function () { setConflictPrompt(null); }}
                      disabled={busy}
                    >
                      Keep my changes
                    </button>
                  </div>
                </div>
              ) : null}
              {duplicatePrompt ? (
                <div
                  className="error-text"
                  style={{
                    border: "1px solid var(--warn, #d97706)",
                    background: "rgba(217,119,6,0.08)",
                    padding: "10px 12px",
                    borderRadius: 6
                  }}
                >
                  <div style={{ marginBottom: 6 }}>
                    <strong>Possible duplicate.</strong> {duplicatePrompt.message}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button
                      className="button primary"
                      type="button"
                      onClick={confirmDuplicateAndResubmit}
                      disabled={busy}
                    >
                      Create as new patient anyway
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={function () { setDuplicatePrompt(null); }}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {error && !conflictPrompt && !duplicatePrompt ? (
                <div className="error-text">{error}</div>
              ) : null}
              {!error && resource.error ? (
                <div className="error-text">Live patient list error — {resource.error}</div>
              ) : null}
              {message ? <div className="success-text">{message}</div> : null}
              {canWrite ? (
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "Saving..." : form.id ? "Update patient" : "Create patient"}
                  </button>
                  <button className="button secondary" type="button" onClick={resetForm}>
                    Clear
                  </button>
                </div>
              ) : (
                <p className="mini-muted">You have read-only access to patient records.</p>
              )}
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
                  <label htmlFor="patients-search-22">Search</label>
                  <input id="patients-search-22"
                    value={search}
                    onChange={function (event) { setSearch(event.target.value); }}
                    placeholder="Name, mobile, address, area or pincode"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-status-23">Status</label>
                  <select id="patients-status-23" value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                    <option value="">All</option>
                    {patientStatusOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-gender-24">Gender</label>
                  <select id="patients-gender-24" value={genderFilter} onChange={function (event) { setGenderFilter(event.target.value); }}>
                    <option value="">All</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-shift-25">Shift</label>
                  <select id="patients-shift-25" value={shiftFilter} onChange={function (event) { setShiftFilter(event.target.value); }}>
                    <option value="">All</option>
                    {shiftOptions.map(function (item) {
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="patients-area-26">Area</label>
                  <input id="patients-area-26"
                    value={areaFilter}
                    onChange={function (event) { setAreaFilter(event.target.value); }}
                    placeholder="e.g. Naranpura"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-pincode-27">Pincode</label>
                  <input id="patients-pincode-27"
                    value={pinFilter}
                    onChange={function (event) { setPinFilter(event.target.value); }}
                    placeholder="e.g. 380013"
                    inputMode="numeric"
                  />
                </div>
                <div className="field">
                  <label htmlFor="patients-sort-by-28">Sort by</label>
                  <select id="patients-sort-by-28" value={sortOrder} onChange={function (event) { setSortOrder(event.target.value); }}>
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
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
                {resource.total} patient{resource.total === 1 ? "" : "s"} total
                {resource.loading ? " (loading...)" : ""}
              </div>
              {!rows.length ? (
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
                      {rows.map(function (row, index) {
                        const listRow = row as PatientListRow;
                        const rowNum = patientListPosition(resource.page, resource.pageSize, index);
                        return (
                          <tr key={row.id}>
                            <td>{rowNum}</td>
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
                                {canViewHistory ? (
                                  <button
                                    className="button ghost"
                                    type="button"
                                    onClick={function () { openHistory(listRow); }}
                                    disabled={busy}
                                  >
                                    History
                                  </button>
                                ) : null}
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={function () { openPatientPdf(listRow, false); }}
                                  disabled={busy}
                                  title="Print profile with photo + documents"
                                >
                                  Print
                                </button>
                                {canWrite && !isRegistryClosed(listRow.status) ? (
                                  <button
                                    className="button secondary"
                                    type="button"
                                    onClick={function () { editPatient(listRow); }}
                                    disabled={busy}
                                  >
                                    Edit
                                  </button>
                                ) : null}
                                {!isActiveStatus(listRow.status) ? (
                                  <>
                                    {canClose ? (
                                      <button
                                        className="button secondary"
                                        type="button"
                                        onClick={function () { openReopenDialog(listRow); }}
                                        disabled={busy}
                                      >
                                        Reopen
                                      </button>
                                    ) : null}
                                    {isAdmin && isRegistryClosed(listRow.status) ? (
                                      <button
                                        className="button danger"
                                        type="button"
                                        onClick={function () { deletePatientPermanently(listRow.id); }}
                                        disabled={busy}
                                        title="Permanent delete (Admin only). Refused if linked billings, duties, or receipts exist."
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </>
                                ) : canClose ? (
                                  <button
                                    className="button danger"
                                    type="button"
                                    onClick={function () { openCloseDialog(listRow); }}
                                    disabled={busy}
                                  >
                                    Close
                                  </button>
                                ) : null}
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
                  <label htmlFor="patients-reason-29">Reason</label>
                  <select id="patients-reason-29"
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
                    <label htmlFor="patients-specify-other-reason-30">Specify other reason</label>
                    <input id="patients-specify-other-reason-30"
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
                  <label htmlFor="patients-note-optional-for-your-r-31">Note (optional, for your records)</label>
                  <textarea id="patients-note-optional-for-your-r-31"
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

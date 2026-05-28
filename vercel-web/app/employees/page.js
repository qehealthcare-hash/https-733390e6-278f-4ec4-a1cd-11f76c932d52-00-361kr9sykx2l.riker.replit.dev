"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { usePaginatedResource } from "@/hooks/use-paginated-resource";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { useAuth } from "@/components/providers/auth-provider";
import { request, requestWithOfflineFallback } from "@/lib/api-client";
import {
  departmentOptions,
  educationOptions,
  employeeRoleOptions,
  employeeStatusOptions,
  employeeTypeOptions,
  shiftOptions
} from "@/lib/crm-options";
import { formatCurrency, formatDate, slugToText } from "@/lib/formatters";
import { crmTodayIso } from "@/src/utils/crmToday";
import { uploadDocument, getDocumentSignedUrl } from "@/lib/uploads";
import { CameraCaptureModal } from "@/components/ui/camera-capture-lazy";
import { DocumentCard, DocumentList } from "@/components/ui/document-card";
import { openPrintWindow } from "@/lib/print";

function createInitialForm() {
  return {
    id: "",
    fn: "",
    mn: "",
    ln: "",
    mobile: "",
    phone2: "",
    gender: "Female",
    dob: "",
    dept: "NURSING",
    role: "NURSE",
    emp_type: "FULL_TIME",
    education: "ILLITERATE",
    shift_type: "DAY",
    join_date: new Date().toISOString().slice(0, 10),
    leave_date: "",
    exp: "",
    salary: 0,
    aadhar: "",
    pan: "",
    permaddr: "",
    presaddr: "",
    area: "",
    city: "Ahmedabad",
    pin: "",
    district: "",
    state: "Gujarat",
    ecname: "",
    ecphone: "",
    ecrel: "",
    skills: "",
    // Scores stay null = "Not rated" until the operator drags a slider.
    // Tracked per-field so editing an unscored row + saving without touching
    // the meter does not silently write 5/5/5.
    score_experience: null,
    score_behaviour: null,
    score_testimonial: null,
    score_touched: { score_experience: false, score_behaviour: false, score_testimonial: false },
    status: "Active",
    expected_updated_at: "",
    confirm_duplicate_name: false,
    photo: null,
    documents: []
  };
}

function clampScore(value) {
  var n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

// Legacy SPA rows store human-friendly labels (e.g. "Day Shift (9:00 AM – 7:00 PM)",
// "Patient Attendant", "Contract", "Nurse") in the same columns we now expose as
// strict <select> dropdowns. Without normalisation those rows silently render the
// first option and overwrite the stored value on save. Map them back to canonical
// values so the form round-trips legacy data faithfully.
function findOption(options, value) {
  if (value == null) return null;
  var target = String(value).trim();
  if (!target) return null;
  for (var i = 0; i < options.length; i += 1) {
    if (options[i].value === target) return options[i];
  }
  var upper = target.toUpperCase();
  for (var j = 0; j < options.length; j += 1) {
    if (String(options[j].value).toUpperCase() === upper) return options[j];
  }
  return null;
}

function normaliseRoleValue(raw) {
  if (!raw) return "NURSE";
  var match = findOption(employeeRoleOptions, raw);
  if (match) return match.value;
  var lower = String(raw).trim().toLowerCase();
  if (lower.indexOf("nurse") >= 0) return "NURSE";
  if (lower.indexOf("attend") >= 0) return "ATTENDANT";
  if (lower.indexOf("account") >= 0) return "ACCOUNTANT";
  if (lower.indexOf("staff") >= 0) return "STAFF";
  return "OTHER";
}

function normaliseDeptValue(raw) {
  if (!raw) return "NURSING";
  var match = findOption(departmentOptions, raw);
  if (match) return match.value;
  var lower = String(raw).trim().toLowerCase();
  if (lower.indexOf("nurs") >= 0) return "NURSING";
  if (lower.indexOf("attend") >= 0) return "ATTENDANT";
  if (lower.indexOf("admin") >= 0) return "ADMIN";
  if (lower.indexOf("account") >= 0) return "ACCOUNTS";
  if (lower.indexOf("ops") >= 0 || lower.indexOf("operation") >= 0) return "OPS";
  return "ATTENDANT";
}

function normaliseEmpTypeValue(raw) {
  if (!raw) return "FULL_TIME";
  var match = findOption(employeeTypeOptions, raw);
  if (match) return match.value;
  var upper = String(raw).trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (upper === "FULLTIME" || upper === "FULL_TIME") return "FULL_TIME";
  if (upper === "PARTTIME" || upper === "PART_TIME") return "PART_TIME";
  if (upper === "CONTRACT") return "CONTRACT";
  if (upper === "INTERN") return "INTERN";
  var lower = String(raw).trim().toLowerCase();
  if (lower.indexOf("part") >= 0) return "PART_TIME";
  if (lower.indexOf("contract") >= 0) return "CONTRACT";
  if (lower.indexOf("intern") >= 0) return "INTERN";
  return "FULL_TIME";
}

function normaliseShiftValue(raw) {
  if (!raw) return "DAY";
  var match = findOption(shiftOptions, raw);
  if (match) return match.value;
  var upper = String(raw).trim().toUpperCase();
  if (upper === "DAY" || upper === "NIGHT" || upper === "24H" || upper === "ONE_TIME" || upper === "CUSTOM") {
    return upper === "ONE_TIME" || upper === "CUSTOM" || upper === "24H" ? upper : upper;
  }
  var lower = String(raw).trim().toLowerCase();
  if (lower.indexOf("24") >= 0) return "24H";
  if (lower.indexOf("night") >= 0) return "NIGHT";
  if (lower.indexOf("day") >= 0) return "DAY";
  if (lower.indexOf("one") >= 0 || lower.indexOf("1 hour") >= 0 || lower.indexOf("1hr") >= 0) return "ONE_TIME";
  if (lower.indexOf("custom") >= 0) return "CUSTOM";
  return "DAY";
}

function normaliseEducationValue(raw) {
  if (!raw) return "ILLITERATE";
  var match = findOption(educationOptions, raw);
  if (match) return match.value;
  var lower = String(raw).trim().toLowerCase();
  if (lower.indexOf("illit") >= 0) return "ILLITERATE";
  if (lower.indexOf("graduate") >= 0) return "GRADUATE";
  if (lower.indexOf("12") >= 0 || lower.indexOf("10") >= 0) return "PASS_10_12";
  if (lower.indexOf("below") >= 0) return "BELOW_10";
  return "ILLITERATE";
}

function normaliseStatusValue(raw, active) {
  var fallback = active === false ? "Inactive" : "Active";
  if (!raw) return fallback;
  var match = findOption(employeeStatusOptions, raw);
  if (match) return match.value;
  var lower = String(raw).trim().toLowerCase();
  if (lower.indexOf("inactive") >= 0) return "Inactive";
  if (lower.indexOf("leave") >= 0) return "OnLeave";
  if (lower.indexOf("suspend") >= 0) return "Suspended";
  if (lower.indexOf("active") >= 0) return "Active";
  return fallback;
}

// Mobile values like "7874751265(son)" pollute the input box on edit and confuse
// duplicate detection. Strip annotations to a clean dialable form before rendering
// (server still re-normalises on save, but we want the field to display sanely).
function sanitiseMobileForForm(raw) {
  if (raw == null) return "";
  var trimmed = String(raw).trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^0-9+]/g, "");
}

function computeScoreTotal(form) {
  var parts = [form.score_experience, form.score_behaviour, form.score_testimonial]
    .filter(function (v) { return v != null && Number.isFinite(Number(v)); })
    .map(function (v) { return Number(v); });
  if (!parts.length) return null;
  var avg = parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
  return Math.round(avg * 100) / 100;
}

function rowScoreTotal(row) {
  if (row == null) return null;
  if (row.score_total != null && Number.isFinite(Number(row.score_total))) {
    return Number(row.score_total);
  }
  var parts = [row.score_experience, row.score_behaviour, row.score_testimonial]
    .map(function (v) { return Number(v); })
    .filter(function (v) { return Number.isFinite(v); });
  if (!parts.length) return null;
  return Math.round((parts.reduce(function (a, b) { return a + b; }, 0) / parts.length) * 100) / 100;
}

export default function EmployeesPage() {
  var auth = useAuth();
  var isAdmin = String(auth.profile?.role || "").trim().toUpperCase() === "ADMIN";
  var canManage = isAdmin || ["MANAGER"].includes(String(auth.profile?.role || "").trim().toUpperCase());
  var [search, setSearch] = useState("");
  var [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(
    function () {
      var handle = setTimeout(function () {
        setDebouncedSearch(search.trim());
      }, 300);
      return function () { clearTimeout(handle); };
    },
    [search]
  );

  var [form, setForm] = useState(createInitialForm());
  // P1-36: stable draft id for uploads that fire before the employee row
  // has been persisted. Once form.id exists we prefer that.
  var employeeDraftIdRef = useRef(
    "draft-" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36))
  );
  var [busy, setBusy] = useState(false);
  var [roleFilter, setRoleFilter] = useState("");
  var [statusFilter, setStatusFilter] = useState("");
  var [deptFilter, setDeptFilter] = useState("");
  var [typeFilter, setTypeFilter] = useState("");
  var [genderFilter, setGenderFilter] = useState("");
  var [eduFilter, setEduFilter] = useState("");
  var [shiftFilter, setShiftFilter] = useState("");
  var [scoreFilter, setScoreFilter] = useState("");
  var [error, setError] = useState("");
  var [fieldErrors, setFieldErrors] = useState(null);
  var [message, setMessage] = useState("");

  var [statusDialog, setStatusDialog] = useState(null);
  var [activateDialog, setActivateDialog] = useState(null);
  var [deleteDialog, setDeleteDialog] = useState(null);
  var [conflictPrompt, setConflictPrompt] = useState(null);
  var [duplicatePrompt, setDuplicatePrompt] = useState(null);
  var [historyDialog, setHistoryDialog] = useState(null);
  var [cameraOpen, setCameraOpen] = useState(false);
  var [historyData, setHistoryData] = useState(null);
  var [historyLoading, setHistoryLoading] = useState(false);
  var [historyError, setHistoryError] = useState("");

  var listQuery = useMemo(
    function () {
      return {
        q: debouncedSearch || undefined,
        status: statusFilter || undefined,
        dept: deptFilter || undefined
      };
    },
    [debouncedSearch, statusFilter, deptFilter]
  );

  var resource = usePaginatedResource({
    basePath: "/employees",
    table: "hh_employees",
    channel: "employees",
    queryParams: listQuery,
    resetKey: debouncedSearch + "|" + statusFilter + "|" + deptFilter,
    pageSize: 50
  });

  async function openHistory(row) {
    var name = (row.full_name || row.name || ((row.fn || "") + " " + (row.ln || ""))).trim() || row.id;
    setHistoryDialog({ id: row.id, name: name });
    setHistoryData(null);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      var results = await Promise.allSettled([
        request("/employees/" + row.id + "/links", null, auth.session),
        request("/audits?entity_id=" + encodeURIComponent(row.id) + "&limit=20", null, auth.session)
      ]);
      var linkCounts = results[0].status === "fulfilled" ? (results[0].value || {}) : {};
      var auditPayload = results[1].status === "fulfilled" ? (results[1].value || {}) : {};
      var auditRows = Array.isArray(auditPayload)
        ? auditPayload
        : auditPayload.rows || auditPayload.data || [];
      setHistoryData({ counts: linkCounts, audit: auditRows });
      if (results[0].status === "rejected" && results[1].status === "rejected") {
        setHistoryError(results[0].reason?.message || results[1].reason?.message || "Could not load history");
      }
    } catch (err) {
      setHistoryError(err?.message || "Could not load employee history");
    } finally {
      setHistoryLoading(false);
    }
  }

  var filtered = useMemo(
    function () {
      return resource.data.filter(function (row) {
        var name = (row.full_name || row.name || (row.fn || "") + " " + (row.ln || "")).trim();
        var hay = [name, row.mobile || row.phone, row.permaddr || row.addr, row.role || row.desig, row.dept, row.skills]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        var matchesRole = !roleFilter || (row.role || row.desig) === roleFilter;
        var matchesStatus = true;
        var matchesDept = true;
        var matchesType = !typeFilter || (row.emp_type || row.etype || row.employee_type) === typeFilter;
        var matchesGender = !genderFilter || row.gender === genderFilter;
        var matchesEdu = !eduFilter || (row.education || row.edu) === eduFilter;
        var matchesShift = !shiftFilter || (row.shift_type || row.shift) === shiftFilter;
        var matchesScore = true;
        if (scoreFilter) {
          var s = rowScoreTotal(row);
          if (scoreFilter === "8plus") matchesScore = s != null && s >= 8;
          else if (scoreFilter === "6to8") matchesScore = s != null && s >= 6 && s < 8;
          else if (scoreFilter === "lt6") matchesScore = s != null && s < 6;
          else if (scoreFilter === "unset") matchesScore = s == null;
        }
        return (
          matchesRole &&
          matchesStatus &&
          matchesDept &&
          matchesType &&
          matchesGender &&
          matchesEdu &&
          matchesShift &&
          matchesScore
        );
      });
    },
    [resource.data, roleFilter, typeFilter, genderFilter, eduFilter, shiftFilter, scoreFilter]
  );

  function updateField(name, value) {
    setForm(function (current) {
      var next = { ...current, [name]: value };
      if (name === "score_experience" || name === "score_behaviour" || name === "score_testimonial") {
        next.score_touched = { ...(current.score_touched || {}), [name]: true };
      }
      return next;
    });
  }

  function resetForm() {
    setForm(createInitialForm());
    setError("");
    setFieldErrors(null);
    setMessage("");
  }

  function editEmployee(row) {
    var fullName = row.full_name || row.name || ((row.fn || "") + " " + (row.ln || "")).trim();
    var parts = fullName.split(/\s+/).filter(Boolean);
    setForm({
      id: row.id,
      fn: row.fn || parts[0] || "",
      mn: row.mn || (parts.length > 2 ? parts.slice(1, -1).join(" ") : ""),
      ln: row.ln || (parts.length > 1 ? parts[parts.length - 1] : ""),
      mobile: sanitiseMobileForForm(row.mobile || row.phone || ""),
      phone2: sanitiseMobileForForm(row.phone2 || ""),
      gender: row.gender || "Female",
      dob: row.dob || "",
      dept: normaliseDeptValue(row.dept || row.department),
      role: normaliseRoleValue(row.role || row.desig),
      emp_type: normaliseEmpTypeValue(row.emp_type || row.etype || row.employee_type),
      education: normaliseEducationValue(row.education || row.edu),
      shift_type: normaliseShiftValue(row.shift_type || row.shift),
      join_date: row.join_date || row.joining_date || row.join || "",
      leave_date: row.leave_date || row.leave || "",
      exp: row.exp || "",
      salary: row.salary || 0,
      aadhar: row.aadhar != null ? String(row.aadhar) : "",
      pan: row.pan != null ? String(row.pan) : "",
      permaddr: row.permaddr != null ? String(row.permaddr) : "",
      presaddr: row.presaddr != null ? String(row.presaddr) : "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      pin: row.pin || row.pincode || "",
      district: row.district || "",
      state: row.state || "Gujarat",
      ecname: row.ecname || row.relname || "",
      ecphone: sanitiseMobileForForm(row.ecphone || row.relphone || ""),
      ecrel: row.ecrel || "",
      skills: row.skills || "",
      score_experience: row.score_experience != null ? Number(row.score_experience) : null,
      score_behaviour: row.score_behaviour != null ? Number(row.score_behaviour) : null,
      score_testimonial: row.score_testimonial != null ? Number(row.score_testimonial) : null,
      // Pre-marking touched=true only for fields that ALREADY have a value
      // means an unscored employee saved without slider interaction will
      // continue to be unscored (no silent 5/5/5 regression).
      score_touched: {
        score_experience: row.score_experience != null,
        score_behaviour: row.score_behaviour != null,
        score_testimonial: row.score_testimonial != null
      },
      status: normaliseStatusValue(row.status, row.active),
      expected_updated_at: row.updated_at || "",
      confirm_duplicate_name: false,
      photo: row.photo && typeof row.photo === "object" ? row.photo : null,
      documents: row.employee_documents || row.docs || []
    });
    setError("");
    setFieldErrors(null);
    setMessage("");
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
            bucket: "employee-documents",
            file: files[i],
            session: auth.session,
            supabase: auth.supabase,
            resource: "Employees",
            resourceId: form.id || employeeDraftIdRef.current
          })
        );
      }
      setForm(function (current) {
        return { ...current, documents: current.documents.concat(uploaded) };
      });
      setMessage("Employee documents uploaded");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload employee documents");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function uploadEmployeePhotoFile(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      var uploaded = await uploadDocument({
        bucket: "employee-documents",
        file: file,
        session: auth.session,
        supabase: auth.supabase,
        resource: "Employees",
        resourceId: form.id || employeeDraftIdRef.current
      });
      setForm(function (current) { return { ...current, photo: uploaded }; });
      setMessage("Photo uploaded");
    } catch (uploadError) {
      setError(uploadError.message || "Unable to upload photo");
    } finally {
      setBusy(false);
    }
  }

  async function handlePhotoUpload(event) {
    var file = (event.target.files || [])[0];
    event.target.value = "";
    await uploadEmployeePhotoFile(file);
  }

  async function handleEmployeeCameraCapture(file) {
    setCameraOpen(false);
    await uploadEmployeePhotoFile(file);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFieldErrors(null);
    setMessage("");
    try {
      // Documents are recommended for Active employees but no longer hard-required
      // (it was blocking edits on legacy rows that never had docs uploaded).
      // Warn instead so the operator is aware.
      if (form.status === "Active" && !form.documents.length) {
        // eslint-disable-next-line no-console
        console.warn("Saving Active employee with no documents on file.");
      }
      var fullName = [form.fn, form.mn, form.ln].filter(Boolean).join(" ").trim();
      var cleanMobile = sanitiseMobileForForm(form.mobile);
      var cleanRole = normaliseRoleValue(form.role);
      var cleanDept = normaliseDeptValue(form.dept);
      var cleanEmpType = normaliseEmpTypeValue(form.emp_type);
      var cleanEducation = normaliseEducationValue(form.education);
      var cleanShift = normaliseShiftValue(form.shift_type);
      var cleanStatus = normaliseStatusValue(form.status, form.status !== "Inactive");
      var payload = {
        fn: form.fn,
        mn: form.mn,
        ln: form.ln,
        name: fullName,
        full_name: fullName,
        phone: cleanMobile,
        mobile: cleanMobile,
        phone2: sanitiseMobileForForm(form.phone2 || ""),
        gender: form.gender || "",
        dob: form.dob || "",
        dept: cleanDept,
        desig: cleanRole,
        role: cleanRole,
        emp_type: cleanEmpType,
        etype: cleanEmpType,
        edu: cleanEducation,
        education: cleanEducation,
        shift: cleanShift,
        shift_type: cleanShift,
        join: form.join_date || "",
        join_date: form.join_date || "",
        joining_date: form.join_date || "",
        leave: form.leave_date || "",
        leave_date: form.leave_date || "",
        exp: form.exp || "",
        salary: Number(form.salary || 0),
        aadhar: form.aadhar || "",
        pan: form.pan || "",
        permaddr: form.permaddr || "",
        presaddr: form.presaddr || "",
        addr: form.permaddr || form.presaddr || "",
        address: form.permaddr || form.presaddr || "",
        area: form.area || "",
        city: form.city || "",
        pin: form.pin || "",
        pincode: form.pin || "",
        district: form.district || "",
        state: form.state || "",
        ecname: form.ecname || "",
        ecphone: sanitiseMobileForForm(form.ecphone || ""),
        ecrel: form.ecrel || "",
        relname: form.ecname || "",
        relphone: sanitiseMobileForForm(form.ecphone || ""),
        skills: form.skills || "",
        status: cleanStatus,
        active: cleanStatus === "Active",
        photo: form.photo || undefined,
        docs: form.documents,
        documents: form.documents
      };
      // Only forward score fields the operator actually touched (or that
      // already had a value loaded from the row). This prevents silent
      // overwrites to 5/5/5 on edit-and-save of an unscored employee.
      var touched = form.score_touched || {};
      if (touched.score_experience && form.score_experience != null) {
        payload.score_experience = clampScore(form.score_experience);
      }
      if (touched.score_behaviour && form.score_behaviour != null) {
        payload.score_behaviour = clampScore(form.score_behaviour);
      }
      if (touched.score_testimonial && form.score_testimonial != null) {
        payload.score_testimonial = clampScore(form.score_testimonial);
      }
      var maybeTotal = computeScoreTotal(form);
      if (maybeTotal != null) payload.score_total = maybeTotal;
      if (form.id && form.expected_updated_at) {
        payload.expected_updated_at = form.expected_updated_at;
      }
      if (form.confirm_duplicate_name) {
        payload.confirm_duplicate_name = true;
      }
      var saved = await requestWithOfflineFallback(
        form.id ? "/employees/" + form.id : "/employees",
        { method: form.id ? "PUT" : "POST", body: payload },
        auth.session
      );
      await resource.reload();
      if (form.id && saved) {
        editEmployee(saved);
        setMessage("Employee updated — fields reflect saved values");
      } else {
        resetForm();
        setMessage("Employee created successfully");
      }
    } catch (submitError) {
      var code = submitError?.code;
      if (code === "conflict") {
        setConflictPrompt({
          actual: submitError?.details?.actual_updated_at,
          message:
            submitError.message ||
            "Employee was modified by another user — reload to see their changes."
        });
      } else if (
        code === "duplicate" &&
        (submitError?.details?.field === "name" || submitError?.details?.field === "aadhar") &&
        !form.id
      ) {
        setDuplicatePrompt({
          field: submitError.details.field,
          message: submitError.message || "An active employee with this identity already exists."
        });
      } else {
        setError(submitError.message || "Unable to save employee");
        if (code === "validation_error" && submitError?.details) {
          setFieldErrors({
            fields: submitError.details.fieldErrors || {},
            form: submitError.details.formErrors || []
          });
        } else {
          setFieldErrors(null);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function reloadEmployeeFromConflict() {
    if (!form.id) {
      setConflictPrompt(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      var fresh = await request("/employees/" + form.id, null, auth.session);
      editEmployee(fresh);
      setConflictPrompt(null);
      setMessage("Employee reloaded — your previous edits were discarded.");
    } catch (reloadError) {
      setError(reloadError.message || "Could not reload employee.");
    } finally {
      setBusy(false);
    }
  }

  function confirmDuplicateAndResubmit() {
    setDuplicatePrompt(null);
    setForm(function (current) { return { ...current, confirm_duplicate_name: true }; });
    setMessage("Will save as a separate employee on the next save — press Save.");
  }

  function changeStatus(id, nextStatus, rowName) {
    if (nextStatus === "Active") {
      setActivateDialog({ id: id, name: rowName || "", note: "" });
      return;
    }
    setStatusDialog({ id: id, name: rowName || "", nextStatus: nextStatus, reason: "" });
  }

  async function applyStatusChange(id, nextStatus, reason) {
    setBusy(true);
    setError("");
    setActivateDialog(function (current) { return current ? { ...current, error: "" } : current; });
    setStatusDialog(function (current) { return current ? { ...current, error: "" } : current; });
    try {
      await requestWithOfflineFallback(
        "/employees/" + id + "/status",
        { method: "POST", body: { status: nextStatus, reason: reason } },
        auth.session
      );
      await resource.reload();
      if (form.id === id) resetForm();
      setMessage("Employee → " + nextStatus);
      setStatusDialog(null);
      setActivateDialog(null);
    } catch (err) {
      var msg = err && err.message ? err.message : "Unable to change status";
      setError(msg);
      setActivateDialog(function (current) { return current ? { ...current, error: msg } : current; });
      setStatusDialog(function (current) { return current ? { ...current, error: msg } : current; });
    } finally {
      setBusy(false);
    }
  }

  async function resolveDocLinks(docs) {
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

  async function openEmployeePdf(row, hideSensitive) {
    // P1-32: open the print window SYNCHRONOUSLY inside the user gesture,
    // before any await. Otherwise Chrome / Safari popup-block the window once
    // the signed-URL resolution returns. The opened tab shows "Loading…" until
    // openPrintWindow rewrites its document.
    var preOpened = window.open("about:blank", "_blank", "width=1024,height=820");
    if (preOpened && preOpened.document) {
      try {
        preOpened.document.write("<title>Preparing PDF…</title><body style='font-family:Segoe UI,Arial,sans-serif;padding:32px;color:#475569'>Loading employee profile…</body>");
      } catch (_e) { /* opaque about:blank — ignore */ }
    }
    var name = row.full_name || row.name || ((row.fn || "") + " " + (row.ln || "")).trim();
    var score = rowScoreTotal(row);
    var isActive = row.status ? row.status === "Active" : row.active !== false;
    var rawDocs = row.employee_documents || row.docs || [];
    var photoDoc = row.photo && typeof row.photo === "object" && row.photo.path ? row.photo : null;
    var resolvedDocs = await resolveDocLinks(rawDocs);
    var resolvedPhoto = photoDoc ? (await resolveDocLinks([photoDoc]))[0] : null;
    var docs = rawDocs;
    function escape(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    }
    function field(label, value) {
      return (
        "<tr><th style='width:180px'>" +
        escape(label) +
        "</th><td>" +
        escape(value || "-") +
        "</td></tr>"
      );
    }
    function mask(value) {
      var s = String(value || "");
      if (!s) return "";
      if (s.length <= 4) return "****";
      return "****" + s.slice(-4);
    }
    var rows = [
      field("Employee ID", row.id),
      field("Name", name),
      field("Type", slugToText(row.emp_type || row.etype || row.employee_type || "")),
      field("Designation", slugToText(row.role || row.desig || "")),
      field("Department", slugToText(row.dept || row.department || "")),
      field("Shift", slugToText(row.shift_type || row.shift || "")),
      field("Education", slugToText(row.education || row.edu || "")),
      field("Skills", row.skills),
      field("Area", row.area),
      field("Phone", hideSensitive ? "" : row.mobile || row.phone),
      field("Alt phone", hideSensitive ? "" : row.phone2),
      field("Aadhar", hideSensitive ? mask(row.aadhar) : row.aadhar),
      field("PAN", hideSensitive ? mask(row.pan) : row.pan),
      field("Permanent address", row.permaddr || row.addr || row.address),
      field("Present address", row.presaddr),
      field(
        "PIN · District · State",
        [row.pin || row.pincode, row.district, row.state].filter(Boolean).join(" · ")
      ),
      field(
        "Emergency contact",
        row.ecname
          ? row.ecname + (row.ecphone ? " · " + row.ecphone : "") + (row.ecrel ? " (" + row.ecrel + ")" : "")
          : ""
      ),
      field(
        "Performance score",
        score == null
          ? "Not rated"
          : score.toFixed(2) +
              " / 10  (Exp " +
              (row.score_experience ?? "-") +
              " · Beh " +
              (row.score_behaviour ?? "-") +
              " · Tst " +
              (row.score_testimonial ?? "-") +
              ")"
      ),
      field("Status", (row.status || (isActive ? "Active" : "Inactive")) || "Active"),
      field("Joining date", formatDate(row.join_date || row.join)),
      row.leave_date || row.leave ? field("Leaving date", formatDate(row.leave_date || row.leave)) : "",
      field("Salary", row.salary ? formatCurrency(row.salary) + " /mo" : ""),
      field("Experience", row.exp),
      field("Documents on file", String(docs.length || 0))
    ].join("");
    function isImg(d) {
      var m = String(d.mime_type || "").toLowerCase();
      if (m.indexOf("image/") === 0) return true;
      var n = String(d.file_name || d.path || "").toLowerCase();
      return /\.(jpe?g|png|webp|heic|heif|gif)$/.test(n);
    }
    function isPdf(d) {
      if (String(d.mime_type || "").toLowerCase() === "application/pdf") return true;
      var n = String(d.file_name || d.path || "").toLowerCase();
      return /\.pdf$/.test(n);
    }
    var photoHtml = resolvedPhoto && resolvedPhoto.signedUrl
      ? "<div style='text-align:center;margin:8px 0 16px'><img src='" +
        escape(resolvedPhoto.signedUrl) +
        "' alt='Employee photo' style='max-width:160px;max-height:200px;border:1px solid #cbd5e1;border-radius:8px'/></div>"
      : "";
    var docsHtml = "";
    if (resolvedDocs.length) {
      docsHtml = "<h3>Attached documents (" + resolvedDocs.length + ")</h3>";
      docsHtml += "<ol style='line-height:1.7'>";
      resolvedDocs.forEach(function (d) {
        var name = escape(d.file_name || d.path || "Document");
        var tag = isPdf(d) ? "PDF" : isImg(d) ? "IMG" : "FILE";
        var link = d.signedUrl
          ? "<a href='" + escape(d.signedUrl) + "' target='_blank' rel='noopener'>" + name + "</a>"
          : name;
        docsHtml += "<li>[" + tag + "] " + link + "</li>";
      });
      docsHtml += "</ol>";
      var imageDocs = resolvedDocs.filter(function (d) {
        return isImg(d) && d.signedUrl;
      });
      if (imageDocs.length) {
        docsHtml +=
          "<h3>Document previews</h3>" +
          "<div style='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px'>" +
          imageDocs
            .map(function (d) {
              return (
                "<div style='border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center'>" +
                "<div style='font-size:12px;color:#475569;margin-bottom:6px'>" +
                escape(d.file_name || d.path) +
                "</div>" +
                "<img src='" +
                escape(d.signedUrl) +
                "' alt='" +
                escape(d.file_name || "doc") +
                "' style='max-width:100%;max-height:320px;object-fit:contain'/>" +
                "</div>"
              );
            })
            .join("") +
          "</div>";
      }
    }
    var body =
      "<h2>Employee Profile</h2>" +
      photoHtml +
      "<table><tbody>" +
      rows +
      "</tbody></table>" +
      docsHtml;
    openPrintWindow(
      hideSensitive ? "Employee Profile (sanitised)" : "Employee Profile - " + name,
      body,
      preOpened
    );
  }

  function openEmployeeDirectoryPdf() {
    var listRows = filtered
      .map(function (row, index) {
        var name = row.full_name || row.name || ((row.fn || "") + " " + (row.ln || "")).trim();
        var score = rowScoreTotal(row);
        var isActive = row.status ? row.status === "Active" : row.active !== false;
        return (
          "<tr>" +
          "<td>" + (index + 1) + "</td>" +
          "<td>" + (row.id || "-") + "</td>" +
          "<td>" + (name || "-") + "</td>" +
          "<td>" + slugToText(row.role || row.desig || "") + "</td>" +
          "<td>" + slugToText(row.dept || row.department || "") + "</td>" +
          "<td>" + slugToText(row.shift_type || row.shift || "") + "</td>" +
          "<td>" + (score == null ? "—" : score.toFixed(1)) + "</td>" +
          "<td>" + (row.mobile || row.phone || "") + "</td>" +
          "<td>" + (row.status || (isActive ? "Active" : "Inactive")) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    var body =
      "<h2>Employee Directory</h2>" +
      "<div class='meta'>" + filtered.length + " staff · generated " + formatDate(new Date().toISOString()) + "</div>" +
      "<table><thead><tr>" +
      "<th>#</th><th>ID</th><th>Name</th><th>Role</th><th>Dept</th><th>Shift</th><th>Score</th><th>Phone</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      (listRows || "<tr><td colspan='9'>No employees match the current filters.</td></tr>") +
      "</tbody></table>";
    openPrintWindow("Employee Directory", body);
  }

  function openDeleteDialog(row) {
    setDeleteDialog({
      id: row.id,
      name: row.full_name || row.name || row.id,
      reason: ""
    });
  }

  async function submitDeleteDialog() {
    if (!deleteDialog) return;
    setBusy(true);
    setError("");
    try {
      var result = await requestWithOfflineFallback(
        "/employees/" + deleteDialog.id,
        { method: "DELETE", body: { reason: deleteDialog.reason.trim() } },
        auth.session
      );
      await resource.reload();
      if (form.id === deleteDialog.id) resetForm();
      setMessage(
        result && result.mode === "soft"
          ? "Employee deactivated (history preserved)"
          : "Employee deleted"
      );
      setDeleteDialog(null);
    } catch (err) {
      setError(err.message || "Unable to delete employee");
    } finally {
      setBusy(false);
    }
  }

  async function submitActivateDialog() {
    if (!activateDialog) return;
    await applyStatusChange(activateDialog.id, "Active", activateDialog.note.trim());
  }

  return (
    <AuthGuard permission="employees.read">
      <AppShell title="Employees">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit employee" : "Add employee"}
            description="Full HR profile: personal, ID, address, job, skills, emergency contact, photo and documents."
          >
            {!canManage ? (
              <div className="info-text" role="status">
                You have read-only access. Only Admin/Manager can add or edit employees.
              </div>
            ) : null}
            <fieldset
              className="stack"
              style={{ border: 0, padding: 0, margin: 0 }}
              disabled={!canManage}
            >
            <form className="stack" onSubmit={handleSubmit}>
              <strong>Personal</strong>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="employees-first-name-1">First name</label>
                  <input id="employees-first-name-1" value={form.fn} onChange={function (event) { updateField("fn", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="employees-middle-name-2">Middle name</label>
                  <input id="employees-middle-name-2" value={form.mn} onChange={function (event) { updateField("mn", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-last-name-3">Last name</label>
                  <input id="employees-last-name-3" value={form.ln} onChange={function (event) { updateField("ln", event.target.value); }} />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="employees-mobile-4">Mobile</label>
                  <input id="employees-mobile-4" type="tel" inputMode="tel" value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label htmlFor="employees-alternate-phone-5">Alternate phone</label>
                  <input id="employees-alternate-phone-5" type="tel" inputMode="tel" value={form.phone2} onChange={function (event) { updateField("phone2", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-date-of-birth-6">Date of birth</label>
                  <input id="employees-date-of-birth-6" type="date" max={crmTodayIso()} value={form.dob} onChange={function (event) { updateField("dob", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-gender-7">Gender</label>
                  <select id="employees-gender-7" value={form.gender} onChange={function (event) { updateField("gender", event.target.value); }}>
                    <option>Female</option>
                    <option>Male</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <strong>Identification</strong>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="employees-aadhar-8">Aadhar</label>
                  <input id="employees-aadhar-8"
                    value={form.aadhar}
                    onChange={function (event) { updateField("aadhar", event.target.value); }}
                    pattern="\d{12}"
                    maxLength={12}
                    inputMode="numeric"
                    placeholder="123456789012"
                  />
                </div>
                <div className="field">
                  <label htmlFor="employees-pan-9">PAN</label>
                  <input id="employees-pan-9"
                    value={form.pan}
                    onChange={function (event) { updateField("pan", event.target.value.toUpperCase()); }}
                    pattern="[A-Z]{5}\d{4}[A-Z]"
                    maxLength={10}
                    placeholder="ABCDE1234F"
                  />
                </div>
              </div>

              <strong>Address</strong>
              <div className="field">
                <label htmlFor="employees-permanent-address-10">Permanent address</label>
                <textarea id="employees-permanent-address-10" rows="2" value={form.permaddr} onChange={function (event) { updateField("permaddr", event.target.value); }} />
              </div>
              <div className="field">
                <label htmlFor="employees-present-address-11">Present address</label>
                <textarea id="employees-present-address-11" rows="2" value={form.presaddr} onChange={function (event) { updateField("presaddr", event.target.value); }} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="employees-area-12">Area</label>
                  <input id="employees-area-12" value={form.area} onChange={function (event) { updateField("area", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-city-13">City</label>
                  <input id="employees-city-13" value={form.city} onChange={function (event) { updateField("city", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-pincode-14">Pincode</label>
                  <input id="employees-pincode-14" value={form.pin} onChange={function (event) { updateField("pin", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-district-15">District</label>
                  <input id="employees-district-15" value={form.district} onChange={function (event) { updateField("district", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-state-16">State</label>
                  <input id="employees-state-16" value={form.state} onChange={function (event) { updateField("state", event.target.value); }} />
                </div>
              </div>

              <strong>Job</strong>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="employees-department-17">Department</label>
                  <select id="employees-department-17" value={form.dept} onChange={function (event) { updateField("dept", event.target.value); }}>
                    {departmentOptions.map(function (d) {
                      return <option key={d.value} value={d.value}>{d.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-role-designation-18">Role / designation</label>
                  <select id="employees-role-designation-18" value={form.role} onChange={function (event) { updateField("role", event.target.value); }}>
                    {employeeRoleOptions.map(function (r) {
                      return <option key={r.value} value={r.value}>{r.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-employment-type-19">Employment type</label>
                  <select id="employees-employment-type-19" value={form.emp_type} onChange={function (event) { updateField("emp_type", event.target.value); }}>
                    {employeeTypeOptions.map(function (e) {
                      return <option key={e.value} value={e.value}>{e.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-education-20">Education</label>
                  <select id="employees-education-20" value={form.education} onChange={function (event) { updateField("education", event.target.value); }}>
                    {educationOptions.map(function (e) {
                      return <option key={e.value} value={e.value}>{e.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-shift-21">Shift</label>
                  <select id="employees-shift-21" value={form.shift_type} onChange={function (event) { updateField("shift_type", event.target.value); }}>
                    {shiftOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-salary-monthly-22">Salary (monthly)</label>
                  <input id="employees-salary-monthly-22" type="number" min="0" value={form.salary} onChange={function (event) { updateField("salary", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-joining-date-23">Joining date</label>
                  <input id="employees-joining-date-23" type="date" value={form.join_date} onChange={function (event) { updateField("join_date", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-leaving-date-24">Leaving date</label>
                  <input id="employees-leaving-date-24" type="date" value={form.leave_date} onChange={function (event) { updateField("leave_date", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-experience-25">Experience</label>
                  <input id="employees-experience-25" value={form.exp} onChange={function (event) { updateField("exp", event.target.value); }} placeholder="e.g. 3 years" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="employees-skills-26">Skills</label>
                <textarea id="employees-skills-26" rows="2" value={form.skills} onChange={function (event) { updateField("skills", event.target.value); }} placeholder="e.g. Wound care, IV, BP, post-op care" />
              </div>

              <strong>Performance score (0-10)</strong>
              <div className="grid-3">
                {["score_experience", "score_behaviour", "score_testimonial"].map(function (key) {
                  var label = key === "score_experience" ? "Experience" : key === "score_behaviour" ? "Behaviour" : "Testimonial";
                  var raw = form[key];
                  var touched = !!(form.score_touched && form.score_touched[key]);
                  var displayValue = raw == null ? 5 : Number(raw);
                  return (
                    <div className="field" key={key}>
                      <label htmlFor="employees-label-27">{label}</label>
                      <input id="employees-label-27"
                        type="range"
                        min="0"
                        max="10"
                        step="0.5"
                        value={displayValue}
                        onChange={function (event) { updateField(key, event.target.value); }}
                      />
                      <small>
                        {touched && raw != null ? Number(raw).toFixed(1) + "/10" : "Not rated"}
                        {touched && raw != null ? (
                          <button
                            type="button"
                            style={{
                              marginLeft: 8,
                              background: "none",
                              border: 0,
                              color: "var(--accent, #2563eb)",
                              cursor: "pointer",
                              padding: 0,
                              font: "inherit",
                              textDecoration: "underline"
                            }}
                            onClick={function () {
                              setForm(function (current) {
                                return {
                                  ...current,
                                  [key]: null,
                                  score_touched: { ...(current.score_touched || {}), [key]: false }
                                };
                              });
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                      </small>
                    </div>
                  );
                })}
              </div>
              <div className="helper-box">
                <strong>Total score:</strong>{" "}
                {(function () {
                  var t = computeScoreTotal(form);
                  return t == null ? "Not rated" : t.toFixed(2) + " / 10";
                })()}
              </div>

              <strong>Emergency contact</strong>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="employees-name-28">Name</label>
                  <input id="employees-name-28" value={form.ecname} onChange={function (event) { updateField("ecname", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-phone-29">Phone</label>
                  <input id="employees-phone-29" value={form.ecphone} onChange={function (event) { updateField("ecphone", event.target.value); }} />
                </div>
                <div className="field">
                  <label htmlFor="employees-relation-30">Relation</label>
                  <input id="employees-relation-30" value={form.ecrel} onChange={function (event) { updateField("ecrel", event.target.value); }} placeholder="e.g. Spouse, Father" />
                </div>
              </div>

              <strong>Status & files</strong>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="employees-status-31">Status</label>
                  <select id="employees-status-31" value={form.status} onChange={function (event) { updateField("status", event.target.value); }}>
                    {employeeStatusOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-photo-32">Photo</label>
                  <div className="button-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input id="employees-photo-32"
                      type="file"
                      accept="image/*"
                      capture="user"
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
                    <small>Mobile camera works from the file picker too.</small>
                  )}
                </div>
              </div>
              <div className="field">
                <label htmlFor="employees-documents-form-documents-33">Documents ({form.documents.length})</label>
                <input id="employees-documents-form-documents-33"
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={handleUpload}
                />
                <small>Aadhar, PAN, certificates, contract, photos. JPG/PNG/HEIC/PDF up to 25 MB each.</small>
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
                      onClick={reloadEmployeeFromConflict}
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
                      Dismiss
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
                    <strong>Possible duplicate ({duplicatePrompt.field}).</strong> {duplicatePrompt.message}
                  </div>
                  <div className="button-row" style={{ gap: 8 }}>
                    <button
                      className="button primary"
                      type="button"
                      onClick={confirmDuplicateAndResubmit}
                      disabled={busy}
                    >
                      Create as new employee anyway
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
                <div className="error-text">
                  <div>{error}</div>
                  {fieldErrors && (
                    (fieldErrors.fields && Object.keys(fieldErrors.fields).length > 0) ||
                    (fieldErrors.form && fieldErrors.form.length > 0)
                  ) ? (
                    <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: "12px" }}>
                      {(fieldErrors.form || []).map(function (msg, idx) {
                        return <li key={"f" + idx}>{msg}</li>;
                      })}
                      {Object.entries(fieldErrors.fields || {}).map(function (entry) {
                        var field = entry[0];
                        var msgs = entry[1] || [];
                        if (!msgs.length) return null;
                        return (
                          <li key={field}>
                            <strong>{field}:</strong> {msgs.filter(Boolean).join(", ")}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {!error && !conflictPrompt && !duplicatePrompt && resource.error ? (
                <div className="error-text">Live employee list error — {resource.error}</div>
              ) : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy || !canManage}>
                  {busy ? "Saving..." : form.id ? "Update employee" : "Create employee"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
            </fieldset>
          </ModuleShell>

          <div className="page-grid">
            <ModuleShell
              title="Workforce"
              description="Filter, edit, or change status. Soft-delete preserves history."
              actions={
                <div className="button-row">
                  <button className="button secondary" type="button" onClick={openEmployeeDirectoryPdf}>
                    Directory PDF
                  </button>
                  <button className="button secondary" type="button" onClick={resource.reload}>
                    Refresh
                  </button>
                </div>
              }
            >
              <div className="toolbar">
                <div className="field">
                  <label htmlFor="employees-search-34">Search</label>
                  <input id="employees-search-34"
                    value={search}
                    onChange={function (event) { setSearch(event.target.value); }}
                    placeholder="Name, role, mobile, skills"
                  />
                </div>
                <div className="field">
                  <label htmlFor="employees-role-35">Role</label>
                  <select id="employees-role-35" value={roleFilter} onChange={function (event) { setRoleFilter(event.target.value); }}>
                    <option value="">All</option>
                    {employeeRoleOptions.map(function (r) {
                      return <option key={r.value} value={r.value}>{r.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-department-36">Department</label>
                  <select id="employees-department-36" value={deptFilter} onChange={function (event) { setDeptFilter(event.target.value); }}>
                    <option value="">All</option>
                    {departmentOptions.map(function (d) {
                      return <option key={d.value} value={d.value}>{d.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-type-37">Type</label>
                  <select id="employees-type-37" value={typeFilter} onChange={function (event) { setTypeFilter(event.target.value); }}>
                    <option value="">All</option>
                    {employeeTypeOptions.map(function (t) {
                      return <option key={t.value} value={t.value}>{t.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-gender-38">Gender</label>
                  <select id="employees-gender-38" value={genderFilter} onChange={function (event) { setGenderFilter(event.target.value); }}>
                    <option value="">All</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-education-39">Education</label>
                  <select id="employees-education-39" value={eduFilter} onChange={function (event) { setEduFilter(event.target.value); }}>
                    <option value="">All</option>
                    {educationOptions.map(function (e) {
                      return <option key={e.value} value={e.value}>{e.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-shift-40">Shift</label>
                  <select id="employees-shift-40" value={shiftFilter} onChange={function (event) { setShiftFilter(event.target.value); }}>
                    <option value="">All</option>
                    {shiftOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-score-41">Score</label>
                  <select id="employees-score-41" value={scoreFilter} onChange={function (event) { setScoreFilter(event.target.value); }}>
                    <option value="">All</option>
                    <option value="8plus">≥ 8 (top)</option>
                    <option value="6to8">6 - 7.99</option>
                    <option value="lt6">&lt; 6</option>
                    <option value="unset">Not rated</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="employees-status-42">Status</label>
                  <select id="employees-status-42" value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                    <option value="">All</option>
                    {employeeStatusOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
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
                {resource.total} employee{resource.total === 1 ? "" : "s"} total
                {roleFilter || typeFilter || genderFilter || eduFilter || shiftFilter || scoreFilter
                  ? " · extra filters apply to this page only"
                  : ""}
                {resource.loading ? " (loading...)" : ""}
              </div>
              {!filtered.length ? (
                <EmptyState
                  title={resource.loading ? "Loading employees..." : "No matching staff"}
                  description={
                    debouncedSearch
                      ? "No employee matches \"" + debouncedSearch + "\". Try fewer characters or a phone suffix."
                      : "Your field workforce will appear here with their HR profile and payout readiness."
                  }
                />
              ) : (
                <div className="record-list">
                  {filtered.map(function (row, index) {
                    var rowNum = (resource.page - 1) * resource.pageSize + index + 1;
                    var name = row.full_name || row.name || ((row.fn || "") + " " + (row.ln || "")).trim();
                    var isActive = row.status ? row.status === "Active" : row.active !== false;
                    var score = rowScoreTotal(row);
                    var scoreClass = score == null ? "muted" : score >= 8 ? "high" : score >= 6 ? "mid" : "low";
                    return (
                      <div className="record-card" key={row.id}>
                        <div className="button-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <h3>
                              <span className="row-number">#{index + 1}</span>
                              {name || row.id}
                            </h3>
                            <div className="record-meta">
                              <span>{row.id}</span>
                              <span>{row.mobile || row.phone || "-"}</span>
                              <span>{slugToText(row.role || row.desig || "")}</span>
                              <span>{slugToText(row.shift_type || row.shift || "")}</span>
                              {row.salary ? <span>{formatCurrency(row.salary)}/mo</span> : null}
                            </div>
                          </div>
                          <div className="record-side">
                            <span className={"score-pill score-" + scoreClass} title="Performance score">
                              {score == null ? "—" : score.toFixed(1)}/10
                            </span>
                            <span className={"status " + (isActive ? "active" : "paused")}>{row.status || (isActive ? "Active" : "Inactive")}</span>
                          </div>
                        </div>
                        <div className="record-meta" style={{ marginTop: 12 }}>
                          <span>{slugToText(row.education || row.edu || "")}</span>
                          {row.join_date || row.join ? <span>Joined {formatDate(row.join_date || row.join)}</span> : null}
                          {row.aadhar ? <span>Aadhar ***{String(row.aadhar).slice(-4)}</span> : null}
                          {row.pan ? <span>PAN {row.pan}</span> : null}
                          <span>{(row.employee_documents || row.docs || []).length || 0} docs</span>
                        </div>
                        {row.skills ? (
                          <div className="helper-box" style={{ marginTop: 12 }}>
                            <strong>Skills:</strong> {row.skills}
                          </div>
                        ) : null}
                        <div className="button-row" style={{ marginTop: 12 }}>
                          <button className="button secondary" type="button" onClick={function () { editEmployee(row); }}>
                            Edit
                          </button>
                          <button className="button ghost" type="button" onClick={function () { openHistory(row); }}>
                            History
                          </button>
                          {!isActive ? (
                            <button className="button primary" type="button" onClick={function () { changeStatus(row.id, "Active", row.full_name || row.name); }}>
                              Activate
                            </button>
                          ) : (
                            <>
                              <button className="button secondary" type="button" onClick={function () { changeStatus(row.id, "OnLeave", row.full_name || row.name); }}>
                                On leave
                              </button>
                              <button className="button secondary" type="button" onClick={function () { changeStatus(row.id, "Suspended", row.full_name || row.name); }}>
                                Suspend
                              </button>
                              <button className="button ghost" type="button" onClick={function () { changeStatus(row.id, "Inactive", row.full_name || row.name); }}>
                                Deactivate
                              </button>
                            </>
                          )}
                          <button className="button secondary" type="button" onClick={function () { openEmployeePdf(row, false); }}>
                            PDF
                          </button>
                          <button className="button secondary" type="button" onClick={function () { openEmployeePdf(row, true); }}>
                            PDF (sanitised)
                          </button>
                          {isAdmin ? (
                            <button className="button danger" type="button" onClick={function () { openDeleteDialog(row); }}>
                              Delete
                            </button>
                          ) : null}
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

      <CameraCaptureModal
        open={cameraOpen}
        onClose={function () { setCameraOpen(false); }}
        onCapture={handleEmployeeCameraCapture}
        facingMode="user"
      />

      {activateDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setActivateDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Reactivate employee</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setActivateDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">
              {activateDialog.name ? activateDialog.name + " — " : ""}This will set status to Active and clear the leave date.
            </p>
            {activateDialog.error ? (
              <div className="alert alert-error" role="alert" style={{ marginBottom: 8 }}>
                {activateDialog.error}
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="employees-note-optional-43">Note (optional)</label>
              <textarea id="employees-note-optional-43"
                rows="3"
                value={activateDialog.note}
                onChange={function (e) {
                  var value = e.target.value;
                  setActivateDialog(function (current) { return current ? { ...current, note: value } : current; });
                }}
                placeholder="Why is this employee being reactivated?"
              />
            </div>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setActivateDialog(null); }}>
                Cancel
              </button>
              <button className="button primary" type="button" disabled={busy} onClick={submitActivateDialog}>
                {busy ? "Saving..." : "Confirm Active"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setDeleteDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Delete employee</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setDeleteDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">
              {deleteDialog.name ? deleteDialog.name + " — " : ""}
              If this employee has duties, attendance, payouts, or patient assignments, they will be deactivated instead of permanently deleted.
            </p>
            <div className="field">
              <label htmlFor="employees-reason-optional-44">Reason (optional)</label>
              <textarea id="employees-reason-optional-44"
                rows="3"
                value={deleteDialog.reason}
                onChange={function (e) {
                  var value = e.target.value;
                  setDeleteDialog(function (current) { return current ? { ...current, reason: value } : current; });
                }}
                placeholder="Why is this employee being removed?"
              />
            </div>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setDeleteDialog(null); }}>
                Cancel
              </button>
              <button className="button danger" type="button" disabled={busy} onClick={submitDeleteDialog}>
                {busy ? "Working..." : "Confirm delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {statusDialog ? (
        <div className="modal-backdrop" onClick={function () { if (!busy) setStatusDialog(null); }}>
          <div className="card modal-card" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>Change status → {statusDialog.nextStatus}</h3>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setStatusDialog(null); }}>×</button>
            </div>
            <p className="mini-muted">
              {statusDialog.name ? statusDialog.name + " — " : ""}This change is written to the audit log.
            </p>
            {statusDialog.error ? (
              <div className="alert alert-error" role="alert" style={{ marginBottom: 8 }}>
                {statusDialog.error}
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="employees-reason-optional-45">Reason (optional)</label>
              <textarea id="employees-reason-optional-45"
                rows="3"
                value={statusDialog.reason}
                onChange={function (e) {
                  var value = e.target.value;
                  setStatusDialog(function (current) { return current ? { ...current, reason: value } : current; });
                }}
                placeholder={"Why is this employee being marked " + statusDialog.nextStatus + "?"}
              />
            </div>
            <div className="button-row" style={{ justifyContent: "flex-end" }}>
              <button className="button ghost" type="button" disabled={busy} onClick={function () { setStatusDialog(null); }}>
                Cancel
              </button>
              <button
                className={statusDialog.nextStatus === "Inactive" ? "button danger" : "button primary"}
                type="button"
                disabled={busy}
                onClick={function () { applyStatusChange(statusDialog.id, statusDialog.nextStatus, statusDialog.reason.trim()); }}
              >
                {busy ? "Saving..." : "Confirm " + statusDialog.nextStatus}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyDialog ? (
        <div className="modal-backdrop" onClick={function () { setHistoryDialog(null); }}>
          <div className="card modal-card modal-wide" onClick={function (e) { e.stopPropagation(); }}>
            <div className="modal-head">
              <h3>History — {historyDialog.name}</h3>
              <button className="button ghost" type="button" onClick={function () { setHistoryDialog(null); }}>×</button>
            </div>
            {historyLoading ? <p className="mini-muted">Loading history…</p> : null}
            {historyError ? <p style={{ color: "var(--danger)" }}>{historyError}</p> : null}
            {historyData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="grid-3">
                  <div>
                    <strong>Duties:</strong> {historyData.counts?.duties ?? 0}
                  </div>
                  <div>
                    <strong>Attendance:</strong> {historyData.counts?.attendance ?? 0}
                  </div>
                  <div>
                    <strong>Payouts:</strong> {historyData.counts?.payouts ?? 0}
                  </div>
                </div>
                {Array.isArray(historyData.audit) && historyData.audit.length ? (
                  <div>
                    <strong>Recent audit trail:</strong>
                    <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                      {historyData.audit.map(function (entry, idx) {
                        return (
                          <li key={entry.id || idx} className="mini-muted">
                            {formatDate(entry.created_at)} — {entry.action || "change"}
                            {entry.user_id ? " by " + entry.user_id : ""}
                            {entry.stamp || entry.reason ? " (" + (entry.stamp || entry.reason) + ")" : ""}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="mini-muted">No audit entries available for this employee.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </AuthGuard>
  );
}

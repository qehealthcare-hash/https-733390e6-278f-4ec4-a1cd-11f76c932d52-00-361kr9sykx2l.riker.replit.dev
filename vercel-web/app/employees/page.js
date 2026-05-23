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
  departmentOptions,
  educationOptions,
  employeeRoleOptions,
  employeeStatusOptions,
  employeeTypeOptions,
  shiftOptions
} from "@/lib/crm-options";
import { formatCurrency, formatDate, slugToText } from "@/lib/formatters";
import { uploadDocument } from "@/lib/uploads";
import { CameraCaptureModal } from "@/components/ui/camera-capture";
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
    photo: null,
    documents: []
  };
}

function clampScore(value) {
  var n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
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
      return "/employees?" + params.join("&");
    },
    [debouncedSearch, pageSize]
  );

  var resource = useRealtimeResource({
    apiPath: apiPath,
    table: "hh_employees",
    channel: "employees"
  });
  var [form, setForm] = useState(createInitialForm());
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
  var [message, setMessage] = useState("");

  var [statusDialog, setStatusDialog] = useState(null);
  var [historyDialog, setHistoryDialog] = useState(null);
  var [cameraOpen, setCameraOpen] = useState(false);
  var [historyData, setHistoryData] = useState(null);
  var [historyLoading, setHistoryLoading] = useState(false);
  var [historyError, setHistoryError] = useState("");

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
        var matchesSearch = !search || hay.indexOf(search.toLowerCase()) >= 0;
        var matchesRole = !roleFilter || (row.role || row.desig) === roleFilter;
        var matchesStatus = !statusFilter || row.status === statusFilter;
        var matchesDept = !deptFilter || (row.dept || row.department) === deptFilter;
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
          matchesSearch &&
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
    [resource.data, search, roleFilter, statusFilter, deptFilter, typeFilter, genderFilter, eduFilter, shiftFilter, scoreFilter]
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
      mobile: row.mobile || row.phone || "",
      phone2: row.phone2 || "",
      gender: row.gender || "Female",
      dob: row.dob || "",
      dept: row.dept || "NURSING",
      role: row.role || row.desig || "NURSE",
      emp_type: row.emp_type || row.etype || "FULL_TIME",
      education: row.education || row.edu || "ILLITERATE",
      shift_type: row.shift_type || row.shift || "DAY",
      join_date: row.join_date || row.joining_date || row.join || "",
      leave_date: row.leave_date || row.leave || "",
      exp: row.exp || "",
      salary: row.salary || 0,
      aadhar: row.aadhar || "",
      pan: row.pan || "",
      permaddr: row.permaddr || row.addr || row.address || "",
      presaddr: row.presaddr || "",
      area: row.area || "",
      city: row.city || "Ahmedabad",
      pin: row.pin || row.pincode || "",
      district: row.district || "",
      state: row.state || "Gujarat",
      ecname: row.ecname || row.relname || "",
      ecphone: row.ecphone || row.relphone || "",
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
      status: row.status || (row.active === false ? "Inactive" : "Active"),
      photo: row.photo && typeof row.photo === "object" ? row.photo : null,
      documents: row.employee_documents || row.docs || []
    });
    setError("");
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
            supabase: auth.supabase
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
        supabase: auth.supabase
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
      var payload = {
        fn: form.fn,
        mn: form.mn,
        ln: form.ln,
        name: fullName,
        full_name: fullName,
        phone: form.mobile,
        mobile: form.mobile,
        phone2: form.phone2 || "",
        gender: form.gender || "",
        dob: form.dob || "",
        dept: form.dept || "",
        desig: form.role,
        role: form.role,
        emp_type: form.emp_type || "",
        etype: form.emp_type || "",
        edu: form.education,
        education: form.education,
        shift: form.shift_type,
        shift_type: form.shift_type,
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
        ecphone: form.ecphone || "",
        ecrel: form.ecrel || "",
        relname: form.ecname || "",
        relphone: form.ecphone || "",
        skills: form.skills || "",
        status: form.status,
        active: form.status === "Active",
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
      await requestWithOfflineFallback(
        form.id ? "/employees/" + form.id : "/employees",
        { method: form.id ? "PUT" : "POST", body: payload },
        auth.session
      );
      await resource.reload();
      resetForm();
      setMessage(form.id ? "Employee updated successfully" : "Employee created successfully");
    } catch (submitError) {
      setError(submitError.message || "Unable to save employee");
    } finally {
      setBusy(false);
    }
  }

  function changeStatus(id, nextStatus, rowName) {
    if (nextStatus === "Active") {
      void applyStatusChange(id, nextStatus, "");
      return;
    }
    setStatusDialog({ id: id, name: rowName || "", nextStatus: nextStatus, reason: "" });
  }

  async function applyStatusChange(id, nextStatus, reason) {
    setBusy(true);
    setError("");
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
    } catch (err) {
      setError(err.message || "Unable to change status");
    } finally {
      setBusy(false);
    }
  }

  function openEmployeePdf(row, hideSensitive) {
    var name = row.full_name || row.name || ((row.fn || "") + " " + (row.ln || "")).trim();
    var score = rowScoreTotal(row);
    var isActive = row.status ? row.status === "Active" : row.active !== false;
    var docs = row.employee_documents || row.docs || [];
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
    var body =
      "<h2>Employee Profile</h2>" +
      "<table><tbody>" +
      rows +
      "</tbody></table>" +
      (docs.length
        ? "<h3>Attached documents</h3><ol>" +
          docs
            .map(function (d) {
              return "<li>" + escape(d.file_name || d.path || "Document") + "</li>";
            })
            .join("") +
          "</ol>"
        : "");
    openPrintWindow(
      hideSensitive ? "Employee Profile (sanitised)" : "Employee Profile - " + name,
      body
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

  async function deleteEmployee(id) {
    if (!window.confirm("Delete this employee? If they have history, they will be deactivated instead.")) return;
    setBusy(true);
    setError("");
    try {
      var result = await requestWithOfflineFallback("/employees/" + id, { method: "DELETE" }, auth.session);
      await resource.reload();
      if (form.id === id) resetForm();
      setMessage(result && result.mode === "soft" ? "Employee deactivated (history preserved)" : "Employee deleted");
    } catch (err) {
      setError(err.message || "Unable to delete employee");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGuard permission="employees.read">
      <AppShell title="Employees">
        <div className="page-split">
          <ModuleShell
            title={form.id ? "Edit employee" : "Add employee"}
            description="Full HR profile: personal, ID, address, job, skills, emergency contact, photo and documents."
          >
            <form className="stack" onSubmit={handleSubmit}>
              <strong>Personal</strong>
              <div className="grid-3">
                <div className="field">
                  <label>First name</label>
                  <input value={form.fn} onChange={function (event) { updateField("fn", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Middle name</label>
                  <input value={form.mn} onChange={function (event) { updateField("mn", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Last name</label>
                  <input value={form.ln} onChange={function (event) { updateField("ln", event.target.value); }} />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Mobile</label>
                  <input value={form.mobile} onChange={function (event) { updateField("mobile", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Alternate phone</label>
                  <input value={form.phone2} onChange={function (event) { updateField("phone2", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Date of birth</label>
                  <input type="date" value={form.dob} onChange={function (event) { updateField("dob", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Gender</label>
                  <select value={form.gender} onChange={function (event) { updateField("gender", event.target.value); }}>
                    <option>Female</option>
                    <option>Male</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <strong>Identification</strong>
              <div className="grid-2">
                <div className="field">
                  <label>Aadhar</label>
                  <input value={form.aadhar} onChange={function (event) { updateField("aadhar", event.target.value); }} placeholder="1234 5678 9012" />
                </div>
                <div className="field">
                  <label>PAN</label>
                  <input value={form.pan} onChange={function (event) { updateField("pan", event.target.value.toUpperCase()); }} placeholder="ABCDE1234F" />
                </div>
              </div>

              <strong>Address</strong>
              <div className="field">
                <label>Permanent address</label>
                <textarea rows="2" value={form.permaddr} onChange={function (event) { updateField("permaddr", event.target.value); }} />
              </div>
              <div className="field">
                <label>Present address</label>
                <textarea rows="2" value={form.presaddr} onChange={function (event) { updateField("presaddr", event.target.value); }} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Area</label>
                  <input value={form.area} onChange={function (event) { updateField("area", event.target.value); }} />
                </div>
                <div className="field">
                  <label>City</label>
                  <input value={form.city} onChange={function (event) { updateField("city", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Pincode</label>
                  <input value={form.pin} onChange={function (event) { updateField("pin", event.target.value); }} />
                </div>
                <div className="field">
                  <label>District</label>
                  <input value={form.district} onChange={function (event) { updateField("district", event.target.value); }} />
                </div>
                <div className="field">
                  <label>State</label>
                  <input value={form.state} onChange={function (event) { updateField("state", event.target.value); }} />
                </div>
              </div>

              <strong>Job</strong>
              <div className="grid-3">
                <div className="field">
                  <label>Department</label>
                  <select value={form.dept} onChange={function (event) { updateField("dept", event.target.value); }}>
                    {departmentOptions.map(function (d) {
                      return <option key={d.value} value={d.value}>{d.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Role / designation</label>
                  <select value={form.role} onChange={function (event) { updateField("role", event.target.value); }}>
                    {employeeRoleOptions.map(function (r) {
                      return <option key={r.value} value={r.value}>{r.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Employment type</label>
                  <select value={form.emp_type} onChange={function (event) { updateField("emp_type", event.target.value); }}>
                    {employeeTypeOptions.map(function (e) {
                      return <option key={e.value} value={e.value}>{e.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Education</label>
                  <select value={form.education} onChange={function (event) { updateField("education", event.target.value); }}>
                    {educationOptions.map(function (e) {
                      return <option key={e.value} value={e.value}>{e.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Shift</label>
                  <select value={form.shift_type} onChange={function (event) { updateField("shift_type", event.target.value); }}>
                    {shiftOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Salary (monthly)</label>
                  <input type="number" min="0" value={form.salary} onChange={function (event) { updateField("salary", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Joining date</label>
                  <input type="date" value={form.join_date} onChange={function (event) { updateField("join_date", event.target.value); }} required />
                </div>
                <div className="field">
                  <label>Leaving date</label>
                  <input type="date" value={form.leave_date} onChange={function (event) { updateField("leave_date", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Experience</label>
                  <input value={form.exp} onChange={function (event) { updateField("exp", event.target.value); }} placeholder="e.g. 3 years" />
                </div>
              </div>
              <div className="field">
                <label>Skills</label>
                <textarea rows="2" value={form.skills} onChange={function (event) { updateField("skills", event.target.value); }} placeholder="e.g. Wound care, IV, BP, post-op care" />
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
                      <label>{label}</label>
                      <input
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
                  <label>Name</label>
                  <input value={form.ecname} onChange={function (event) { updateField("ecname", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={form.ecphone} onChange={function (event) { updateField("ecphone", event.target.value); }} />
                </div>
                <div className="field">
                  <label>Relation</label>
                  <input value={form.ecrel} onChange={function (event) { updateField("ecrel", event.target.value); }} placeholder="e.g. Spouse, Father" />
                </div>
              </div>

              <strong>Status & files</strong>
              <div className="grid-2">
                <div className="field">
                  <label>Status</label>
                  <select value={form.status} onChange={function (event) { updateField("status", event.target.value); }}>
                    {employeeStatusOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Photo</label>
                  <div className="button-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input
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
                  {form.photo
                    ? <small>{form.photo.file_name || form.photo.path}</small>
                    : <small>Mobile camera works from the file picker too.</small>}
                </div>
              </div>
              <div className="field">
                <label>Documents</label>
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={handleUpload}
                />
                <small>Aadhar, PAN, certificates, contract, photos. JPG/PNG/HEIC/PDF up to 25 MB each.</small>
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
                <div className="error-text">Live employee list error — {resource.error}</div>
              ) : null}
              {message ? <div className="success-text">{message}</div> : null}
              <div className="button-row">
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? "Saving..." : form.id ? "Update employee" : "Create employee"}
                </button>
                <button className="button secondary" type="button" onClick={resetForm}>
                  Clear
                </button>
              </div>
            </form>
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
                  <label>Search</label>
                  <input
                    value={search}
                    onChange={function (event) { setSearch(event.target.value); }}
                    placeholder="Name, role, mobile, skills"
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
                  <label>Role</label>
                  <select value={roleFilter} onChange={function (event) { setRoleFilter(event.target.value); }}>
                    <option value="">All</option>
                    {employeeRoleOptions.map(function (r) {
                      return <option key={r.value} value={r.value}>{r.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Department</label>
                  <select value={deptFilter} onChange={function (event) { setDeptFilter(event.target.value); }}>
                    <option value="">All</option>
                    {departmentOptions.map(function (d) {
                      return <option key={d.value} value={d.value}>{d.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Type</label>
                  <select value={typeFilter} onChange={function (event) { setTypeFilter(event.target.value); }}>
                    <option value="">All</option>
                    {employeeTypeOptions.map(function (t) {
                      return <option key={t.value} value={t.value}>{t.label}</option>;
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
                  <label>Education</label>
                  <select value={eduFilter} onChange={function (event) { setEduFilter(event.target.value); }}>
                    <option value="">All</option>
                    {educationOptions.map(function (e) {
                      return <option key={e.value} value={e.value}>{e.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Shift</label>
                  <select value={shiftFilter} onChange={function (event) { setShiftFilter(event.target.value); }}>
                    <option value="">All</option>
                    {shiftOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
                  </select>
                </div>
                <div className="field">
                  <label>Score</label>
                  <select value={scoreFilter} onChange={function (event) { setScoreFilter(event.target.value); }}>
                    <option value="">All</option>
                    <option value="8plus">≥ 8 (top)</option>
                    <option value="6to8">6 - 7.99</option>
                    <option value="lt6">&lt; 6</option>
                    <option value="unset">Not rated</option>
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={statusFilter} onChange={function (event) { setStatusFilter(event.target.value); }}>
                    <option value="">All</option>
                    {employeeStatusOptions.map(function (s) {
                      return <option key={s.value} value={s.value}>{s.label}</option>;
                    })}
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
                            <button className="button danger" type="button" onClick={function () { deleteEmployee(row.id); }}>
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
            <div className="field">
              <label>Reason (optional)</label>
              <textarea
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

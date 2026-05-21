import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function buildEmployeeId() {
  return "EMP" + String(Date.now());
}

function splitName(fullName) {
  var parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    fn: parts[0] || "",
    mn: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    ln: parts.length > 1 ? parts[parts.length - 1] : ""
  };
}

function normalizeEmployeeRole(row) {
  var raw = String(row.emp_type || row.desig || row.dept || "").toLowerCase();
  if (raw.indexOf("nurse") >= 0) return "NURSE";
  if (raw.indexOf("account") >= 0) return "ACCOUNTANT";
  if (raw.indexOf("staff") >= 0 || raw.indexOf("coordinator") >= 0 || raw.indexOf("executive") >= 0) return "STAFF";
  return "ATTENDANT";
}

function denormalizeEmployeeRole(role) {
  var value = String(role || "").toUpperCase();
  if (value === "NURSE") {
    return { emp_type: "Nurse", desig: "Nurse", dept: "Nursing" };
  }
  if (value === "ACCOUNTANT") {
    return { emp_type: "Accountant", desig: "Accountant", dept: "Accounts" };
  }
  if (value === "STAFF") {
    return { emp_type: "Staff", desig: "Staff", dept: "Operations" };
  }
  return { emp_type: "Attendant", desig: "Attendant", dept: "Patient Attendant" };
}

function normalizeEducation(value) {
  var raw = String(value || "").trim().toLowerCase();
  if (!raw) return "ILLITERATE";
  if (raw.indexOf("below") >= 0) return "BELOW_10";
  if (raw.indexOf("10") >= 0 || raw.indexOf("12") >= 0) return "PASS_10_12";
  if (raw.indexOf("graduate") >= 0) return "GRADUATE";
  return "ILLITERATE";
}

function denormalizeEducation(value) {
  var raw = String(value || "").toUpperCase();
  if (raw === "BELOW_10") return "Below 10th Pass";
  if (raw === "PASS_10_12") return "10th / 12th / Graduate";
  if (raw === "GRADUATE") return "Graduate";
  return "Illiterate";
}

function normalizeShift(value) {
  var raw = String(value || "").toLowerCase();
  if (raw.indexOf("24") >= 0) return "24H";
  if (raw.indexOf("night") >= 0 || raw.indexOf("8 pm") >= 0) return "NIGHT";
  return "DAY";
}

function denormalizeShift(value) {
  var raw = String(value || "").toUpperCase();
  if (raw === "24H") return "24 Hours";
  if (raw === "NIGHT") return "8 PM – 8 AM (Night)";
  return "9 AM – 7 PM (Day)";
}

function normalizeEmployeeRow(row) {
  var name = [row.fn || "", row.mn || "", row.ln || ""].join(" ").replace(/\s+/g, " ").trim();
  return {
    id: row.id,
    full_name: name,
    mobile: row.phone || "",
    address: row.presaddr || row.permaddr || row.addr || "",
    role: normalizeEmployeeRole(row),
    education: normalizeEducation(row.edu),
    shift_type: normalizeShift(row.shift),
    active: true,
    employee_documents: Array.isArray(row.docs) ? row.docs : [],
    payout_runs: [],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapEmployeePayload(payload, current) {
  var split = splitName(payload.full_name);
  var role = denormalizeEmployeeRole(payload.role);
  return {
    id: current?.id || buildEmployeeId(),
    fn: split.fn,
    mn: split.mn,
    ln: split.ln,
    email: current?.email || "",
    phone: payload.mobile,
    phone2: current?.phone2 || "",
    gender: current?.gender || "",
    dob: current?.dob || "",
    blood: current?.blood || "",
    dept: role.dept,
    etype: current?.etype || "Contract",
    desig: role.desig,
    edu: denormalizeEducation(payload.education),
    join_date: current?.join_date || new Date().toISOString().slice(0, 10),
    leave_date: current?.leave_date || "",
    exp: current?.exp || "",
    company: current?.company || "",
    salary: current?.salary || "",
    refname: current?.refname || "",
    refphone: current?.refphone || "",
    aadhar: current?.aadhar || "",
    pan: current?.pan || "",
    ecname: current?.ecname || "",
    ecphone: current?.ecphone || "",
    ecrel: current?.ecrel || "",
    permaddr: payload.address,
    permpin: current?.permpin || "",
    permdist: current?.permdist || current?.district || "",
    permstate: current?.permstate || current?.state || "",
    presaddr: payload.address,
    prespin: current?.prespin || current?.pin || "",
    presdist: current?.presdist || current?.district || "",
    presstate: current?.presstate || current?.state || "",
    skills: current?.skills || "",
    area: current?.area || "",
    docs: payload.documents || [],
    emp_type: role.emp_type,
    shift: denormalizeShift(payload.shift_type),
    pin: current?.pin || "",
    district: current?.district || "",
    state: current?.state || ""
  };
}

export const employeeService = {
  async list() {
    const result = await supabaseAdmin
      .from("hh_employees")
      .select("*")
      .order("created_at", { ascending: false });
    if (result.error) throw new HttpError(500, result.error.message);
    return (result.data || []).map(normalizeEmployeeRow);
  },

  async getById(id) {
    const result = await supabaseAdmin
      .from("hh_employees")
      .select("*")
      .eq("id", id)
      .single();
    if (result.error) throw new HttpError(result.status || 500, result.error.message);
    return normalizeEmployeeRow(result.data);
  },

  async create(payload) {
    const mapped = mapEmployeePayload(payload);
    const result = await supabaseAdmin.from("hh_employees").insert(mapped).select("*").single();
    if (result.error) throw new HttpError(500, result.error.message);
    return normalizeEmployeeRow(result.data);
  },

  async update(id, payload) {
    const current = await supabaseAdmin.from("hh_employees").select("*").eq("id", id).single();
    if (current.error || !current.data) {
      throw new HttpError(current.status || 404, current.error?.message || "Employee not found");
    }
    const mapped = mapEmployeePayload(payload, current.data);
    const result = await supabaseAdmin.from("hh_employees").update(mapped).eq("id", id).select("*").single();
    if (result.error) throw new HttpError(500, result.error.message);
    return normalizeEmployeeRow(result.data);
  },

  async remove(id) {
    const result = await supabaseAdmin.from("hh_employees").delete().eq("id", id);
    if (result.error) throw new HttpError(500, result.error.message);
    return true;
  },

  async replaceDocuments(employeeId, documents) {
    const result = await supabaseAdmin
      .from("hh_employees")
      .update({ docs: documents || [] })
      .eq("id", employeeId)
      .select("*")
      .single();
    if (result.error) throw new HttpError(500, result.error.message);
    return Array.isArray(result.data.docs) ? result.data.docs : [];
  }
};

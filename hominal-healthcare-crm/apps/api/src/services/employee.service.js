import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

const EMPLOYEE_TABLE = "hh_employees";
const PAYOUT_CHARGE_TABLE = "hh_payout_charges";
const PAYOUT_PAYMENT_TABLE = "hh_paid_transactions";

function parseFlexibleDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function makeMonthKey(value) {
  const parsed = parseFlexibleDate(value);
  if (!parsed) return "unknown";
  return parsed.getFullYear() + "-" + String(parsed.getMonth() + 1).padStart(2, "0");
}

function buildMonthLabel(monthKey) {
  if (!monthKey || monthKey === "unknown") return "Unknown";
  const parts = String(monthKey).split("-");
  if (parts.length !== 2) return monthKey;
  return parts[0] + "-" + parts[1] + "-01";
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    fn: parts[0] || "",
    mn: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    ln: parts.length > 1 ? parts[parts.length - 1] : ""
  };
}

function buildFullName(row) {
  return [row.fn, row.mn, row.ln].filter(Boolean).join(" ").trim();
}

function mapLegacyRole(row) {
  const hay = [row.etype, row.desig, row.emp_type, row.dept].join(" ").toLowerCase();
  if (hay.indexOf("account") >= 0) return "ACCOUNTANT";
  if (hay.indexOf("attendant") >= 0 || hay.indexOf("caretaker") >= 0) return "ATTENDANT";
  if (hay.indexOf("staff") >= 0 || hay.indexOf("telecaller") >= 0 || hay.indexOf("coordinator") >= 0) return "STAFF";
  return "NURSE";
}

function mapLegacyEducation(value) {
  const education = String(value || "").toLowerCase();
  if (education.indexOf("illiterate") >= 0) return "ILLITERATE";
  if (education.indexOf("below") >= 0 || education.indexOf("10th") >= 0) return "BELOW_10";
  if (education.indexOf("graduate") >= 0) return "GRADUATE";
  return "PASS_10_12";
}

function mapLegacyShift(value) {
  const shift = String(value || "").toLowerCase();
  if (shift.indexOf("24") >= 0) return "24H";
  if (shift.indexOf("night") >= 0 || shift.indexOf("8 pm") >= 0) return "NIGHT";
  return "DAY";
}

function mapModernRole(role) {
  switch (String(role || "").toUpperCase()) {
    case "ACCOUNTANT":
      return { etype: "Staff", desig: "Accountant", emp_type: "Staff", dept: "Accounts" };
    case "ATTENDANT":
      return { etype: "Attendant", desig: "Attendant", emp_type: "Attendant", dept: "Caregiving" };
    case "STAFF":
      return { etype: "Staff", desig: "Staff", emp_type: "Staff", dept: "Operations" };
    default:
      return { etype: "Nurse", desig: "Nurse", emp_type: "Nurse", dept: "Nursing" };
  }
}

function mapModernEducation(value) {
  switch (String(value || "").toUpperCase()) {
    case "ILLITERATE":
      return "Illiterate";
    case "BELOW_10":
      return "Below 10th Pass";
    case "GRADUATE":
      return "Graduate";
    default:
      return "10th / 12th / Graduate";
  }
}

function mapModernShift(value) {
  switch (String(value || "").toUpperCase()) {
    case "NIGHT":
      return "8 PM – 8 AM (Night)";
    case "24H":
      return "24 Hours";
    default:
      return "9 AM – 7 PM (Day)";
  }
}

function mapEmployeeRow(row, payoutRuns) {
  const fullName = buildFullName(row);
  return {
    id: row.id,
    full_name: fullName,
    mobile: row.phone || "",
    address: row.presaddr || row.permaddr || "",
    role: mapLegacyRole(row),
    education: mapLegacyEducation(row.edu),
    shift_type: mapLegacyShift(row.shift),
    active: !row.leave_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    employee_documents: Array.isArray(row.docs) ? row.docs : [],
    documents: Array.isArray(row.docs) ? row.docs : [],
    payout_runs: payoutRuns || []
  };
}

function toLegacyPayload(payload, currentRow) {
  const split = splitFullName(payload.full_name);
  const role = mapModernRole(payload.role);
  const active = payload.active !== false;
  return {
    fn: split.fn,
    mn: split.mn,
    ln: split.ln,
    phone: payload.mobile,
    presaddr: payload.address || "",
    permaddr: payload.address || currentRow?.permaddr || "",
    etype: role.etype,
    desig: role.desig,
    emp_type: role.emp_type,
    dept: role.dept,
    edu: mapModernEducation(payload.education),
    shift: mapModernShift(payload.shift_type),
    leave_date: active ? "" : currentRow?.leave_date || new Date().toISOString().slice(0, 10)
  };
}

function buildPayoutRunMap(charges, payments) {
  const chargeGroups = {};
  (charges || []).forEach(function (row) {
    const partnerKey = normalizeName(row.partner);
    if (!partnerKey) return;
    const monthKey = makeMonthKey(row.date);
    const groupKey = partnerKey + "::" + monthKey;
    if (!chargeGroups[groupKey]) {
      chargeGroups[groupKey] = {
        partnerKey,
        payout_month: buildMonthLabel(monthKey),
        total_amount: 0,
        paid_amount: 0,
        pending_amount: 0
      };
    }
    chargeGroups[groupKey].total_amount += Number(row.amount || 0);
  });
  (payments || []).forEach(function (row) {
    const partnerKey = normalizeName(row.partner);
    if (!partnerKey) return;
    const monthKey = makeMonthKey(row.paid_on);
    const groupKey = partnerKey + "::" + monthKey;
    if (!chargeGroups[groupKey]) {
      chargeGroups[groupKey] = {
        partnerKey,
        payout_month: buildMonthLabel(monthKey),
        total_amount: 0,
        paid_amount: 0,
        pending_amount: 0
      };
    }
    chargeGroups[groupKey].paid_amount += Number(row.amount || 0);
  });
  Object.keys(chargeGroups).forEach(function (key) {
    const row = chargeGroups[key];
    row.pending_amount = Math.max(0, row.total_amount - row.paid_amount);
  });
  return chargeGroups;
}

function groupRunsByEmployee(rows, chargeRows, paymentRows) {
  const grouped = buildPayoutRunMap(chargeRows, paymentRows);
  const result = {};
  (rows || []).forEach(function (row) {
    const employeeKey = normalizeName(buildFullName(row));
    result[row.id] = Object.keys(grouped)
      .map(function (key) {
        return grouped[key];
      })
      .filter(function (item) {
        return item.partnerKey === employeeKey;
      })
      .sort(function (a, b) {
        return String(b.payout_month).localeCompare(String(a.payout_month));
      })
      .map(function (item, index) {
        return {
          id: row.id + "-payout-" + index,
          payout_month: item.payout_month,
          total_amount: item.total_amount,
          paid_amount: item.paid_amount,
          pending_amount: item.pending_amount
        };
      });
  });
  return result;
}

function generateEmployeeId() {
  return "EMP" + Date.now().toString().slice(-9);
}

async function fetchEmployeeRows() {
  const result = await supabaseAdmin
    .from(EMPLOYEE_TABLE)
    .select("id, fn, mn, ln, phone, etype, desig, emp_type, dept, edu, shift, presaddr, permaddr, leave_date, docs, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (result.error) throw new HttpError(500, result.error.message);
  return result.data || [];
}

async function fetchPayoutSupportRows() {
  const chargeResult = await supabaseAdmin.from(PAYOUT_CHARGE_TABLE).select("partner, date, amount");
  if (chargeResult.error) throw new HttpError(500, chargeResult.error.message);
  const paymentResult = await supabaseAdmin.from(PAYOUT_PAYMENT_TABLE).select("partner, paid_on, amount");
  if (paymentResult.error) throw new HttpError(500, paymentResult.error.message);
  return {
    charges: chargeResult.data || [],
    payments: paymentResult.data || []
  };
}

export const employeeService = {
  async list() {
    const rows = await fetchEmployeeRows();
    const payoutSupport = await fetchPayoutSupportRows();
    const payoutRunsByEmployee = groupRunsByEmployee(rows, payoutSupport.charges, payoutSupport.payments);
    return rows.map(function (row) {
      return mapEmployeeRow(row, payoutRunsByEmployee[row.id] || []);
    });
  },
  async getById(id) {
    const result = await supabaseAdmin
      .from(EMPLOYEE_TABLE)
      .select("id, fn, mn, ln, phone, etype, desig, emp_type, dept, edu, shift, presaddr, permaddr, leave_date, docs, created_at, updated_at")
      .eq("id", id)
      .single();
    if (result.error) throw new HttpError(result.status || 500, result.error.message);
    const payoutSupport = await fetchPayoutSupportRows();
    const payoutRunsByEmployee = groupRunsByEmployee([result.data], payoutSupport.charges, payoutSupport.payments);
    return mapEmployeeRow(result.data, payoutRunsByEmployee[id] || []);
  },
  async create(payload) {
    const result = await supabaseAdmin
      .from(EMPLOYEE_TABLE)
      .insert({
        id: payload.id || generateEmployeeId(),
        created: new Date().toISOString(),
        docs: payload.documents || [],
        ...toLegacyPayload(payload)
      })
      .select("id, fn, mn, ln, phone, etype, desig, emp_type, dept, edu, shift, presaddr, permaddr, leave_date, docs, created_at, updated_at")
      .single();
    if (result.error) throw new HttpError(500, result.error.message);
    return mapEmployeeRow(result.data, []);
  },
  async update(id, payload) {
    const currentResult = await supabaseAdmin.from(EMPLOYEE_TABLE).select("id, permaddr, leave_date").eq("id", id).single();
    if (currentResult.error) throw new HttpError(currentResult.status || 500, currentResult.error.message);
    const result = await supabaseAdmin
      .from(EMPLOYEE_TABLE)
      .update(toLegacyPayload(payload, currentResult.data))
      .eq("id", id)
      .select("id, fn, mn, ln, phone, etype, desig, emp_type, dept, edu, shift, presaddr, permaddr, leave_date, docs, created_at, updated_at")
      .single();
    if (result.error) throw new HttpError(500, result.error.message);
    const payoutSupport = await fetchPayoutSupportRows();
    const payoutRunsByEmployee = groupRunsByEmployee([result.data], payoutSupport.charges, payoutSupport.payments);
    return mapEmployeeRow(result.data, payoutRunsByEmployee[id] || []);
  },
  async remove(id) {
    const result = await supabaseAdmin.from(EMPLOYEE_TABLE).delete().eq("id", id);
    if (result.error) throw new HttpError(500, result.error.message);
    return true;
  },
  async replaceDocuments(employeeId, documents) {
    const result = await supabaseAdmin
      .from(EMPLOYEE_TABLE)
      .update({
        docs: documents || []
      })
      .eq("id", employeeId)
      .select("docs")
      .single();
    if (result.error) throw new HttpError(500, result.error.message);
    return result.data?.docs || [];
  }
};

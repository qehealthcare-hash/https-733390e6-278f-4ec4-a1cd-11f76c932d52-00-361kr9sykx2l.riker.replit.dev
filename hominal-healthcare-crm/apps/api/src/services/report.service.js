import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function parseFlexibleDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKey(value) {
  const parsed = parseFlexibleDate(value);
  if (!parsed) return "";
  return parsed.getFullYear() + "-" + String(parsed.getMonth() + 1).padStart(2, "0");
}

function buildEmployeeName(row) {
  return [row.fn, row.mn, row.ln].filter(Boolean).join(" ").trim();
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function extractPayoutRate(remarks) {
  const match = String(remarks || "").match(/\[\[RATE:([^\]]+)\]\]/i);
  return match ? Number(match[1]) || 0 : 0;
}

function extractPayoutUnits(remarks) {
  const match = String(remarks || "").match(/\[\[UNITS:([^\]]+)\]\]/i);
  return match ? Number(match[1]) || 0 : 0;
}

function extractManualPatientId(charge) {
  const marker = String(charge.remarks || "").match(/\[\[PATIENT:([^\]]+)\]\]/i);
  if (marker) return String(marker[1] || "").trim();
  const key = String(charge.svc_key || "");
  if (key.indexOf("MANUAL::") !== 0) return "";
  return key.split("::")[2] || "";
}

export const reportService = {
  async patientBilling() {
    const [patientsResult, billingsResult, receiptsResult, svcResult] = await Promise.all([
      supabaseAdmin.from("hh_patients").select("id,name"),
      supabaseAdmin.from("hh_billings").select("id,patient_id,sec_dep"),
      supabaseAdmin.from("hh_receipts").select("billing_id,amount"),
      supabaseAdmin.from("hh_svc_entries").select("billing_id,total")
    ]);
    const errors = [patientsResult, billingsResult, receiptsResult, svcResult].find(function (result) { return result.error; });
    if (errors) throw new HttpError(500, errors.error.message);
    const patientMap = {};
    (patientsResult.data || []).forEach(function (row) { patientMap[row.id] = row.name || ""; });
    const receiptTotals = {};
    (receiptsResult.data || []).forEach(function (row) {
      receiptTotals[row.billing_id] = (receiptTotals[row.billing_id] || 0) + Number(row.amount || 0);
    });
    const serviceTotals = {};
    (svcResult.data || []).forEach(function (row) {
      serviceTotals[row.billing_id] = (serviceTotals[row.billing_id] || 0) + Number(row.total || 0);
    });
    return (billingsResult.data || []).map(function (row) {
      const totalBilled = serviceTotals[row.id] || 0;
      const totalCollected = receiptTotals[row.id] || 0;
      return {
        patient_name: patientMap[row.patient_id] || row.patient_id,
        total_billed: totalBilled,
        total_collected: totalCollected,
        outstanding_amount: Math.max(0, totalBilled - totalCollected),
        security_deposit: Number(row.sec_dep || 0)
      };
    }).sort(function (a, b) { return String(a.patient_name).localeCompare(String(b.patient_name)); });
  },
  async employeePayout() {
    const [employeesResult, chargesResult, paymentsResult] = await Promise.all([
      supabaseAdmin.from("hh_employees").select("id,fn,mn,ln"),
      supabaseAdmin.from("hh_payout_charges").select("partner,amount"),
      supabaseAdmin.from("hh_paid_transactions").select("partner,amount")
    ]);
    const errors = [employeesResult, chargesResult, paymentsResult].find(function (result) { return result.error; });
    if (errors) throw new HttpError(500, errors.error.message);
    const totals = {};
    (employeesResult.data || []).forEach(function (row) {
      const name = buildEmployeeName(row);
      totals[normalizeName(name)] = { employee_name: name, total_due: 0, total_paid: 0, total_pending: 0 };
    });
    (chargesResult.data || []).forEach(function (row) {
      const key = normalizeName(row.partner);
      if (!totals[key]) totals[key] = { employee_name: row.partner || "Employee", total_due: 0, total_paid: 0, total_pending: 0 };
      totals[key].total_due += Number(row.amount || 0);
    });
    (paymentsResult.data || []).forEach(function (row) {
      const key = normalizeName(row.partner);
      if (!totals[key]) totals[key] = { employee_name: row.partner || "Employee", total_due: 0, total_paid: 0, total_pending: 0 };
      totals[key].total_paid += Number(row.amount || 0);
    });
    return Object.keys(totals).map(function (key) {
      totals[key].total_pending = Math.max(0, totals[key].total_due - totals[key].total_paid);
      return totals[key];
    }).sort(function (a, b) { return String(a.employee_name).localeCompare(String(b.employee_name)); });
  },
  async profitLoss() {
    const [receiptsResult, chargesResult] = await Promise.all([
      supabaseAdmin.from("hh_receipts").select("amount,date"),
      supabaseAdmin.from("hh_payout_charges").select("amount,date")
    ]);
    const errors = [receiptsResult, chargesResult].find(function (result) { return result.error; });
    if (errors) throw new HttpError(500, errors.error.message);
    const buckets = {};
    function ensure(key) {
      if (!buckets[key]) buckets[key] = { month_key: key, total_revenue: 0, total_expense: 0, net_profit: 0 };
      return buckets[key];
    }
    (receiptsResult.data || []).forEach(function (row) {
      const key = monthKey(row.date);
      if (!key) return;
      ensure(key).total_revenue += Number(row.amount || 0);
    });
    (chargesResult.data || []).forEach(function (row) {
      const key = monthKey(row.date);
      if (!key) return;
      ensure(key).total_expense += Number(row.amount || 0);
    });
    return Object.keys(buckets).sort().map(function (key) {
      buckets[key].net_profit = buckets[key].total_revenue - buckets[key].total_expense;
      return buckets[key];
    });
  },
  async inquiryConversion() {
    const result = await supabaseAdmin.from("hh_inquiries").select("source,potential,status");
    if (result.error) throw new HttpError(500, result.error.message);
    const grouped = {};
    (result.data || []).forEach(function (row) {
      const source = row.source || "Other";
      if (!grouped[source]) {
        grouped[source] = {
          source,
          total_inquiries: 0,
          converted_to_patients: 0,
          conversion_rate: 0,
          hot_count: 0,
          warm_count: 0,
          cold_count: 0
        };
      }
      grouped[source].total_inquiries += 1;
      const potential = String(row.potential || "").toUpperCase();
      if (potential === "HOT") grouped[source].hot_count += 1;
      else if (potential === "COLD") grouped[source].cold_count += 1;
      else grouped[source].warm_count += 1;
      if (String(row.status || "").toLowerCase() === "converted") grouped[source].converted_to_patients += 1;
    });
    return Object.keys(grouped).map(function (key) {
      const row = grouped[key];
      row.conversion_rate = row.total_inquiries ? ((row.converted_to_patients / row.total_inquiries) * 100).toFixed(1) : "0.0";
      return row;
    }).sort(function (a, b) { return String(a.source).localeCompare(String(b.source)); });
  },
  async attendanceService() {
    const [employeesResult, chargesResult, servicesResult, billingsResult, patientsResult] = await Promise.all([
      supabaseAdmin.from("hh_employees").select("id,fn,mn,ln"),
      supabaseAdmin.from("hh_payout_charges").select("partner,amount,remarks"),
      supabaseAdmin.from("hh_svc_entries").select("partner,count,disc,billing_id"),
      supabaseAdmin.from("hh_billings").select("id,patient_id"),
      supabaseAdmin.from("hh_patients").select("id,name")
    ]);
    const errors = [employeesResult, chargesResult, servicesResult, billingsResult, patientsResult].find(function (result) { return result.error; });
    if (errors) throw new HttpError(500, errors.error.message);
    const patientMap = {};
    (patientsResult.data || []).forEach(function (row) { patientMap[row.id] = row.name || ""; });
    const billingPatientMap = {};
    (billingsResult.data || []).forEach(function (row) { billingPatientMap[row.id] = row.patient_id; });
    const grouped = {};
    (employeesResult.data || []).forEach(function (row) {
      const name = buildEmployeeName(row);
      grouped[normalizeName(name)] = { employee_name: name, patients_served: 0, worked_days: 0, absent_days: 0, _patients: {} };
    });
    (servicesResult.data || []).forEach(function (row) {
      const key = normalizeName(row.partner);
      if (!grouped[key]) grouped[key] = { employee_name: row.partner || "Employee", patients_served: 0, worked_days: 0, absent_days: 0, _patients: {} };
      grouped[key].worked_days += Number(row.count || 0);
      grouped[key].absent_days += Number(row.disc || 0);
      const patientId = billingPatientMap[row.billing_id];
      if (patientId) grouped[key]._patients[patientId] = true;
    });
    (chargesResult.data || []).forEach(function (row) {
      const key = normalizeName(row.partner);
      if (!grouped[key]) grouped[key] = { employee_name: row.partner || "Employee", patients_served: 0, worked_days: 0, absent_days: 0, _patients: {} };
      const patientId = extractManualPatientId(row);
      if (patientId) grouped[key]._patients[patientId] = true;
      if (!grouped[key].worked_days) grouped[key].worked_days += extractPayoutUnits(row.remarks) || 0;
    });
    return Object.keys(grouped).map(function (key) {
      grouped[key].patients_served = Object.keys(grouped[key]._patients).length;
      delete grouped[key]._patients;
      return grouped[key];
    }).sort(function (a, b) { return String(a.employee_name).localeCompare(String(b.employee_name)); });
  }
};

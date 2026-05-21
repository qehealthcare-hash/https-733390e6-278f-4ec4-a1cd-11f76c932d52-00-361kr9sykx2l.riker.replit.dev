import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function monthKey(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.getFullYear() + "-" + String(parsed.getMonth() + 1).padStart(2, "0");
}

function currentMonthKey() {
  return monthKey(new Date().toISOString());
}

export const dashboardService = {
  async summary() {
    const [patientsResult, receiptsResult, payoutChargesResult, paymentsResult, inquiriesResult] = await Promise.all([
      supabaseAdmin.from("hh_patients").select("status", { count: "exact", head: false }),
      supabaseAdmin.from("hh_receipts").select("amount,date"),
      supabaseAdmin.from("hh_payout_charges").select("amount,date"),
      supabaseAdmin.from("hh_paid_transactions").select("amount,paid_on"),
      supabaseAdmin.from("hh_inquiries").select("potential,source", { count: "exact", head: false })
    ]);

    const errors = [patientsResult, receiptsResult, payoutChargesResult, paymentsResult, inquiriesResult].find(function (result) {
      return result.error;
    });
    if (errors) throw new HttpError(500, errors.error.message);

    const patients = patientsResult.data || [];
    const receipts = receiptsResult.data || [];
    const payoutCharges = payoutChargesResult.data || [];
    const payments = paymentsResult.data || [];
    const inquiries = inquiriesResult.data || [];
    const thisMonth = currentMonthKey();

    const monthlyRevenue = receipts.reduce(function (sum, row) {
      return monthKey(row.date) === thisMonth ? sum + Number(row.amount || 0) : sum;
    }, 0);
    const totalPayout = payoutCharges.reduce(function (sum, row) {
      return monthKey(row.date) === thisMonth ? sum + Number(row.amount || 0) : sum;
    }, 0);
    const activePatients = patients.filter(function (row) {
      return String(row.status || "").toLowerCase() === "active";
    }).length;
    const closedPatients = patients.length - activePatients;

    return {
      totalPatients: patients.length,
      activePatients,
      closedPatients,
      monthlyRevenue,
      totalPayout,
      profitLoss: monthlyRevenue - totalPayout,
      totalInquiries: inquiries.length,
      hotInquiries: inquiries.filter(function (row) { return String(row.potential || "").toUpperCase() === "HOT"; }).length,
      totalCollections: receipts.reduce(function (sum, row) { return sum + Number(row.amount || 0); }, 0),
      totalPayoutPayments: payments.reduce(function (sum, row) { return sum + Number(row.amount || 0); }, 0)
    };
  }
};

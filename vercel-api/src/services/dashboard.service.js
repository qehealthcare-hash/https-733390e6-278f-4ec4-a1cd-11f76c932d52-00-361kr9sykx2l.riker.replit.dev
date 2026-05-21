import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

export const dashboardService = {
  async summary() {
    const [
      patientsResult,
      billingsResult,
      payoutsResult,
      inquiriesResult
    ] = await Promise.all([
      supabaseAdmin.from("hh_patients").select("status", { count: "exact", head: false }),
      supabaseAdmin.from("hh_billings").select("*", { count: "exact", head: false }),
      supabaseAdmin.from("hh_paid_transactions").select("amount", { count: "exact", head: false }),
      supabaseAdmin.from("hh_inquiries").select("potential,source", { count: "exact", head: false })
    ]);

    const errors = [patientsResult, billingsResult, payoutsResult, inquiriesResult].find(function (result) {
      return result.error;
    });
    if (errors) throw new HttpError(500, errors.error.message);

    const patients = patientsResult.data || [];
    const billings = billingsResult.data || [];
    const payouts = payoutsResult.data || [];
    const inquiries = inquiriesResult.data || [];

    const monthlyRevenue = billings.reduce(function (sum, row) {
      return sum + Number(row.total || row.amount || row.bill_amount || row.subtotal_amount || 0);
    }, 0);
    const totalPayout = payouts.reduce(function (sum, row) {
      return sum + Number(row.amount || row.total_amount || 0);
    }, 0);

    return {
      totalPatients: patients.length,
      activePatients: patients.filter(function (row) {
        return String(row.status || "").toLowerCase() === "active";
      }).length,
      closedPatients: patients.filter(function (row) {
        var status = String(row.status || "").toLowerCase();
        return status === "closed" || status === "duty closed" || status === "deceased" || status === "discharged" || status === "expired";
      }).length,
      monthlyRevenue,
      totalPayout,
      profitLoss: monthlyRevenue - totalPayout,
      totalInquiries: inquiries.length,
      hotInquiries: inquiries.filter(function (row) {
        return String(row.potential || "").toLowerCase() === "hot";
      }).length
    };
  }
};

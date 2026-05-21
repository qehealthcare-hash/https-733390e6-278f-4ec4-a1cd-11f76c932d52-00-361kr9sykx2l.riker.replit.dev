import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

export const reportService = {
  async patientBilling() {
    const result = await supabaseAdmin
      .from("vw_patient_billing_report")
      .select("*")
      .order("patient_name");
    if (result.error) throw new HttpError(500, result.error.message);
    return result.data || [];
  },
  async employeePayout() {
    const result = await supabaseAdmin
      .from("vw_employee_payout_report")
      .select("*")
      .order("employee_name");
    if (result.error) throw new HttpError(500, result.error.message);
    return result.data || [];
  },
  async profitLoss() {
    const result = await supabaseAdmin
      .from("vw_profit_loss_report")
      .select("*")
      .order("month_key");
    if (result.error) throw new HttpError(500, result.error.message);
    return result.data || [];
  },
  async inquiryConversion() {
    const result = await supabaseAdmin
      .from("vw_inquiry_conversion_report")
      .select("*")
      .order("source");
    if (result.error) throw new HttpError(500, result.error.message);
    return result.data || [];
  },
  async attendanceService() {
    const result = await supabaseAdmin
      .from("vw_attendance_service_report")
      .select("*")
      .order("employee_name");
    if (result.error) throw new HttpError(500, result.error.message);
    return result.data || [];
  }
};

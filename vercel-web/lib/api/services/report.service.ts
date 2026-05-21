import { supabaseAdmin } from "../supabase";

function monthRange(month: string) {
  const m = (month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
    return monthRange(`${y}-${mo}`);
  }
  const [y, mo] = m.split("-").map((n) => parseInt(n, 10));
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  return { period: m, startISO: start.toISOString(), endISO: end.toISOString() };
}

export const reportService = {
  async dashboard(month?: string) {
    const admin = supabaseAdmin();
    const { period, startISO, endISO } = monthRange(month || "");

    const [patientsActive, patientsTotal, inquiriesNew, dutiesScheduled, dutiesCompleted, receiptsMonth, billingsOpen, payoutsMonth, payoutsPaid] = await Promise.all([
      admin.from("hh_patients").select("id", { count: "exact", head: true }).eq("status", "Active"),
      admin.from("hh_patients").select("id", { count: "exact", head: true }),
      admin.from("hh_inquiries").select("id", { count: "exact", head: true }).gte("created_at", startISO).lt("created_at", endISO),
      admin.from("hh_duties").select("id", { count: "exact", head: true }).gte("start_at", startISO).lt("start_at", endISO).in("status", ["SCHEDULED", "IN_PROGRESS"]),
      admin.from("hh_duties").select("id", { count: "exact", head: true }).gte("start_at", startISO).lt("start_at", endISO).eq("status", "COMPLETED"),
      admin.from("hh_receipts").select("amount").gte("created_at", startISO).lt("created_at", endISO),
      admin.from("hh_billings").select("id", { count: "exact", head: true }).eq("status", "Active"),
      admin.from("hh_payouts").select("gross_amount, net_amount, status").eq("period_month", period),
      admin.from("hh_payouts").select("net_amount").eq("period_month", period).eq("status", "PAID")
    ]);

    const collected = (receiptsMonth.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const payoutGross = (payoutsMonth.data || []).reduce((s, r) => s + Number(r.gross_amount || 0), 0);
    const payoutNet = (payoutsMonth.data || []).reduce((s, r) => s + Number(r.net_amount || 0), 0);
    const payoutPaid = (payoutsPaid.data || []).reduce((s, r) => s + Number(r.net_amount || 0), 0);

    return {
      period,
      patients_active: patientsActive.count || 0,
      patients_total: patientsTotal.count || 0,
      inquiries_this_month: inquiriesNew.count || 0,
      duties_scheduled: dutiesScheduled.count || 0,
      duties_completed: dutiesCompleted.count || 0,
      billings_open: billingsOpen.count || 0,
      collected_this_month: collected,
      payout_gross: payoutGross,
      payout_net: payoutNet,
      payout_paid: payoutPaid,
      payout_outstanding: payoutNet - payoutPaid
    };
  },

  async payroll(month?: string) {
    const admin = supabaseAdmin();
    const { period, startISO, endISO } = monthRange(month || "");

    const [payouts, attendance] = await Promise.all([
      admin
        .from("hh_payouts")
        .select("id, employee_id, period_month, gross_amount, advance, deduction, bonus, net_amount, status, duty_count, hours")
        .eq("period_month", period)
        .order("net_amount", { ascending: false }),
      admin
        .from("hh_attendance")
        .select("employee_id, status, hours, check_in_at")
        .gte("check_in_at", startISO)
        .lt("check_in_at", endISO)
    ]);

    const attByEmp = new Map<string, { present: number; absent: number; late: number; hours: number }>();
    for (const a of attendance.data || []) {
      if (!a.employee_id) continue;
      const m = attByEmp.get(a.employee_id) || { present: 0, absent: 0, late: 0, hours: 0 };
      if (a.status === "PRESENT") m.present += 1;
      else if (a.status === "ABSENT") m.absent += 1;
      else if (a.status === "LATE") m.late += 1;
      m.hours += Number(a.hours || 0);
      attByEmp.set(a.employee_id, m);
    }

    const rows = (payouts.data || []).map((p) => ({
      ...p,
      attendance: attByEmp.get(p.employee_id) || { present: 0, absent: 0, late: 0, hours: 0 }
    }));

    return { period, rows, totals: rows.reduce(
      (acc, r) => {
        acc.gross += Number(r.gross_amount || 0);
        acc.net += Number(r.net_amount || 0);
        acc.advance += Number(r.advance || 0);
        acc.deduction += Number(r.deduction || 0);
        acc.bonus += Number(r.bonus || 0);
        return acc;
      },
      { gross: 0, net: 0, advance: 0, deduction: 0, bonus: 0 }
    ) };
  }
};

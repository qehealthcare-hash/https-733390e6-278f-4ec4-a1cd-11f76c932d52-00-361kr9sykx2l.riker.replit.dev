/**
 * Mirrors `hh_employee_pending_payout` / `hh_recompute_payout` charge filters
 * (see hominal_crm_supabase_042_payout_charge_match_100.sql).
 *
 * Diary rows store display name in `partner` and id in `partner_id`.
 */

export interface PayoutChargeLike {
  partner_id?: string | null;
  partner?: string | null;
  remarks?: string | null;
  date?: string | null;
  created_at?: string | null;
}

export function payoutChargeMatchesEmployee(
  charge: PayoutChargeLike,
  employeeId: string
): boolean {
  const id = String(employeeId || "").trim();
  if (!id) return false;
  if (String(charge.partner_id || "").trim() === id) return true;
  if (String(charge.partner || "").trim() === id) return true;
  const partner = String(charge.partner || "").trim();
  const remarks = String(charge.remarks || "");
  if (!partner && remarks.toLowerCase().includes(id.toLowerCase())) return true;
  return false;
}

export function payoutChargeInPeriod(charge: PayoutChargeLike, period: string): boolean {
  const p = String(period || "").trim();
  if (!p) return false;
  const dateStr = String(charge.date || "");
  if (dateStr.length >= 7 && dateStr.slice(0, 7) === p) return true;
  const created = String(charge.created_at || "");
  if (created.length >= 7 && created.slice(0, 7) === p) return true;
  return false;
}

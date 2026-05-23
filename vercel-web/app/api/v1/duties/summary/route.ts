import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { respond } from "@/lib/api/apiResultBridge";
import { ErrorCodes } from "@/types/common";
import { resolveClient } from "@/database/baseRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/duties/summary?patient_id=PID...
 *
 * Returns aggregate billing + payout numbers for the patient — used by the
 * duty calendar to surface "outstanding from patient" and "total payouts to
 * each attendant till date".
 *
 *   {
 *     patient_id,
 *     billed, received, sec_dep, outstanding,
 *     partners: [
 *       { partner_id, name, charges_total, payout_total, paid, due }
 *     ]
 *   }
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const patientId = (url.searchParams.get("patient_id") || "").trim();
  if (!patientId) {
    return respond({
      success: false,
      error: "patient_id is required",
      code: ErrorCodes.badRequest
    });
  }

  const db = resolveClient({ accessToken: actor.accessToken });

  const billingsRes = await db
    .from("hh_billings")
    .select("id, status, sec_dep")
    .eq("patient_id", patientId);
  if (billingsRes.error) {
    return respond({ success: false, error: billingsRes.error.message, code: ErrorCodes.internal });
  }
  const billings = billingsRes.data || [];
  const billingIds = billings.map((b) => String(b.id));
  const activeBillingIds = billings
    .filter((b) => String(b.status || "") === "Active")
    .map((b) => String(b.id));
  const secDep = billings.reduce((s, b) => s + Number(b.sec_dep || 0), 0);

  let billed = 0;
  let received = 0;
  type PartnerAgg = {
    partner_id: string;
    name: string;
    charges_total: number;
    payout_total: number;
    paid: number;
  };
  const partners = new Map<string, PartnerAgg>();

  if (billingIds.length) {
    const svcRes = await db
      .from("hh_svc_entries")
      .select("billing_id, partner_id, partner, total")
      .in("billing_id", billingIds);
    if (svcRes.error) {
      return respond({ success: false, error: svcRes.error.message, code: ErrorCodes.internal });
    }
    for (const row of svcRes.data || []) {
      const total = Number(row.total || 0);
      billed += total;
      const key = String(row.partner_id || row.partner || "(unassigned)");
      const existing = partners.get(key) || {
        partner_id: String(row.partner_id || ""),
        name: String(row.partner || ""),
        charges_total: 0,
        payout_total: 0,
        paid: 0
      };
      existing.charges_total += total;
      if (!existing.name && row.partner) existing.name = String(row.partner);
      partners.set(key, existing);
    }

    const rcRes = await db
      .from("hh_receipts")
      .select("amount")
      .in("billing_id", billingIds)
      .is("deleted_at", null);
    if (rcRes.error) {
      return respond({ success: false, error: rcRes.error.message, code: ErrorCodes.internal });
    }
    for (const row of rcRes.data || []) received += Number(row.amount || 0);

    const svcKeys = billingIds.map((id) => id + "_%");
    const orFilter = svcKeys.map((k) => `svc_key.like.${k}`).join(",");
    const payRes = await db
      .from("hh_payout_charges")
      .select("svc_key, partner_id, partner, amount")
      .or(orFilter);
    if (payRes.error) {
      return respond({ success: false, error: payRes.error.message, code: ErrorCodes.internal });
    }
    for (const row of payRes.data || []) {
      const amt = Number(row.amount || 0);
      const key = String(row.partner_id || row.partner || "(unassigned)");
      const existing = partners.get(key) || {
        partner_id: String(row.partner_id || ""),
        name: String(row.partner || ""),
        charges_total: 0,
        payout_total: 0,
        paid: 0
      };
      existing.payout_total += amt;
      if (!existing.name && row.partner) existing.name = String(row.partner);
      partners.set(key, existing);
    }

    const partnerIds = [...partners.values()]
      .map((p) => p.partner_id)
      .filter(Boolean);
    if (partnerIds.length) {
      const paidRes = await db
        .from("hh_paid_transactions")
        .select("employee_id, partner, amount")
        .in("employee_id", partnerIds);
      if (!paidRes.error) {
        for (const row of paidRes.data || []) {
          const key = String(row.employee_id || row.partner || "(unassigned)");
          const existing = partners.get(key);
          if (existing) existing.paid += Number(row.amount || 0);
        }
      }
    }
  }

  const partnerRows = [...partners.values()].map((p) => ({
    partner_id: p.partner_id,
    name: p.name || p.partner_id || "(unassigned)",
    charges_total: p.charges_total,
    payout_total: p.payout_total,
    paid: p.paid,
    due: Math.max(0, p.payout_total - p.paid)
  }));

  const outstanding = activeBillingIds.length
    ? Math.max(0, billed - received - secDep)
    : Math.max(0, billed - received);

  return respond({
    success: true,
    data: {
      patient_id: patientId,
      billings: billings.length,
      active_billings: activeBillingIds.length,
      billed,
      received,
      sec_dep: secDep,
      outstanding,
      partners: partnerRows.sort((a, b) => b.payout_total - a.payout_total)
    }
  });
});

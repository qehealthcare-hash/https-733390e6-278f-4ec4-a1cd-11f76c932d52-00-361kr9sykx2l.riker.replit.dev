import { isPayoutLocked } from "@/business/payoutRules";
import { payoutRepository } from "@/database/payoutRepository";
import type { DbAccess } from "@/database/types";

/**
 * Recompute payout totals from `hh_payout_charges` only when the period row
 * is still editable. LOCKED/PAID periods must not be mutated by side effects.
 */
export async function recomputePayoutIfEditable(
  employeeId: string,
  period: string,
  access?: DbAccess
): Promise<void> {
  if (!employeeId || !/^\d{4}-\d{2}$/.test(period)) return;
  const existing = await payoutRepository.findByEmployeePeriod(employeeId, period, access);
  if (!existing.success) {
    console.error("[recomputePayoutIfEditable] lookup failed", {
      employeeId,
      period,
      error: existing.error
    });
    return;
  }
  if (existing.data && isPayoutLocked(String(existing.data.status || ""))) {
    return;
  }
  try {
    await payoutRepository.recomputeRpc(employeeId, period, access);
  } catch (err) {
    console.error("[recomputePayoutIfEditable] recompute failed", { employeeId, period, err });
  }
}

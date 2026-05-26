/**
 * Duty-day ledger sync helpers (Phase 11).
 *
 * Thin wrappers over `dutyDayRepository` that:
 *   - Resolve day-row ids from a receipt / charge before calling the repo.
 *   - Swallow + log errors so a ledger write failure NEVER bubbles into the
 *     user-visible flow. We are running the ledger in parallel with the
 *     existing receipt/payout paths until Phase 11b cut-over.
 *
 * All helpers expect the caller's `accessToken`-aware `DbAccess` so reads use
 * RLS where possible and writes ride the admin client (the repository hard-codes
 * service-role behaviour because RLS denies writes to authenticated users).
 */

import type { DbAccess, JsonRow } from "@/database/types";
import {
  dutyDayRepository,
  type SvcEntryShape
} from "@/database/dutyDayRepository";
import { billingRepository } from "@/database/billingRepository";
import { resolveClient } from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const LOG = "[dutyDayLedger]";

function logFailure(scope: string, err: unknown) {
  console.error(`${LOG} ${scope}`, err instanceof Error ? err.message : err);
}

/** Bare-minimum receipt fields the ledger sync needs. */
export interface ReceiptShape {
  id?: string | null;
  billing_id?: string | null;
  patient_id?: string | null;
  from_date?: string | null;
  to_date?: string | null;
  paid_dates?: unknown;
  date?: string | null;
}

function uniqueDates(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const set = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    const s = v.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) set.add(s);
  }
  return Array.from(set).sort();
}

/**
 * Day-row ids matching a receipt's billing × covered dates. Returns at most
 * one row per (billing_id, service_date) — the receipt is responsible for the
 * whole day across whatever svc_entries existed for it. Active (non-deleted,
 * unpaid-to-patient) rows only.
 */
async function findDayRowsForReceipt(
  receipt: ReceiptShape,
  opts: DbAccess | undefined
): Promise<string[]> {
  const billingId = String(receipt.billing_id || "").trim();
  if (!billingId) return [];
  const dates = uniqueDates(receipt.paid_dates);
  if (!dates.length) {
    const from = String(receipt.from_date || "").slice(0, 10);
    const to = String(receipt.to_date || receipt.from_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return [];
    }
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from("hh_duty_days")
          .select("id, service_date")
          .eq("billing_id", billingId)
          .gte("service_date", from)
          .lte("service_date", to)
          .is("paid_receipt_id", null)
          .is("deleted_at", null),
      "dutyDayLedger.findDayRowsForReceipt.range"
    );
    if (!result.success) return [];
    return (result.data || []).map((r) => String(r.id));
  }
  const db = resolveClient(opts);
  const result = await runListQuery<JsonRow>(
    () =>
      db
        .from("hh_duty_days")
        .select("id, service_date")
        .eq("billing_id", billingId)
        .in("service_date", dates)
        .is("paid_receipt_id", null)
        .is("deleted_at", null),
    "dutyDayLedger.findDayRowsForReceipt.list"
  );
  if (!result.success) return [];
  return (result.data || []).map((r) => String(r.id));
}

export const dutyDayLedger = {
  /**
   * Best-effort: link a freshly-saved receipt to its covered day-rows.
   * Never throws; logs and returns 0 on any failure.
   */
  async syncReceiptCreated(
    receipt: ReceiptShape,
    actor: string,
    opts?: DbAccess
  ): Promise<number> {
    try {
      const receiptId = String(receipt.id || "").trim();
      if (!receiptId) return 0;
      const ids = await findDayRowsForReceipt(receipt, opts);
      if (!ids.length) return 0;
      const result = await dutyDayRepository.markPaidToPatient(
        receiptId,
        ids,
        actor,
        opts
      );
      if (!result.success) {
        logFailure("markPaidToPatient", result.error);
        return 0;
      }
      return result.data || 0;
    } catch (err) {
      logFailure("syncReceiptCreated", err);
      return 0;
    }
  },

  /** Best-effort: release every day-row linked to a soft-deleted receipt. */
  async syncReceiptDeleted(
    receiptId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<number> {
    try {
      if (!receiptId) return 0;
      const result = await dutyDayRepository.releaseFromPatient(
        receiptId,
        actor,
        opts
      );
      if (!result.success) {
        logFailure("releaseFromPatient", result.error);
        return 0;
      }
      return result.data || 0;
    } catch (err) {
      logFailure("syncReceiptDeleted", err);
      return 0;
    }
  },

  /**
   * Best-effort: link a freshly-replaced payout charge slice to its
   * corresponding day-rows. Each charge row already carries `date` and
   * `partner_id`, so we look them up by (billing_id, employee_id,
   * service_date) where the day-row is still unpaid-to-staff.
   *
   * `chargeRow.id` is what we'd normally write to `paid_charge_id`, but the
   * legacy `hominal_replace_payout_charges` RPC may not return ids — in that
   * case we fetch the fresh rows by svc_key.
   */
  async syncPayoutChargeCreated(
    chargeRow: {
      id?: string | null;
      billing_id?: string | null;
      partner_id?: string | null;
      service_name?: string | null;
      date?: string | null;
    },
    actor: string,
    opts?: DbAccess
  ): Promise<number> {
    try {
      const chargeId = String(chargeRow.id || "").trim();
      const billingId = String(chargeRow.billing_id || "").trim();
      const employeeId = String(chargeRow.partner_id || "").trim();
      const serviceDate = String(chargeRow.date || "").slice(0, 10);
      if (
        !chargeId ||
        !billingId ||
        !employeeId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
      ) {
        return 0;
      }
      const db = resolveClient(opts);
      const lookup = await runListQuery<JsonRow>(
        () =>
          db
            .from("hh_duty_days")
            .select("id")
            .eq("billing_id", billingId)
            .eq("employee_id", employeeId)
            .eq("service_date", serviceDate)
            .is("paid_charge_id", null)
            .is("deleted_at", null),
        "dutyDayLedger.syncPayoutChargeCreated.lookup"
      );
      if (!lookup.success) {
        logFailure("syncPayoutChargeCreated.lookup", lookup.error);
        return 0;
      }
      const ids = (lookup.data || []).map((r) => String(r.id));
      if (!ids.length) return 0;
      const result = await dutyDayRepository.markPaidToStaff(
        chargeId,
        ids,
        actor,
        opts
      );
      if (!result.success) {
        logFailure("markPaidToStaff", result.error);
        return 0;
      }
      return result.data || 0;
    } catch (err) {
      logFailure("syncPayoutChargeCreated", err);
      return 0;
    }
  },

  async syncPayoutChargeDeleted(
    chargeId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<number> {
    try {
      if (!chargeId) return 0;
      const result = await dutyDayRepository.releaseFromStaff(
        chargeId,
        actor,
        opts
      );
      if (!result.success) {
        logFailure("releaseFromStaff", result.error);
        return 0;
      }
      return result.data || 0;
    } catch (err) {
      logFailure("syncPayoutChargeDeleted", err);
      return 0;
    }
  },

  /** Upsert/refresh the day-rows for a single svc_entry, best-effort. */
  async syncSvcEntryUpsert(
    entry: SvcEntryShape,
    actor: string,
    opts?: DbAccess
  ): Promise<number> {
    try {
      // Resolve patient_id from the billing row when not supplied — the
      // legacy svc_entry shape doesn't carry it.
      let resolved = entry;
      if (!entry.patient_id && entry.billing_id) {
        const billing = await billingRepository.findBillingById(
          String(entry.billing_id),
          opts
        );
        if (billing.success && billing.data) {
          resolved = { ...entry, patient_id: String(billing.data.patient_id || "") };
        }
      }
      const result = await dutyDayRepository.upsertFromSvcEntry(resolved, actor, opts);
      if (!result.success) {
        logFailure("upsertFromSvcEntry", result.error);
        return 0;
      }
      return result.data || 0;
    } catch (err) {
      logFailure("syncSvcEntryUpsert", err);
      return 0;
    }
  },

  /**
   * Soft-delete every active day-row attached to the svc_entry. Used when
   * the legacy `hominal_replace_service_entries` RPC removes a row (it does
   * a full delete + reinsert, so any svc_entry id not present in the new
   * payload represents a removed entry).
   */
  async syncSvcEntryDeleted(
    entryId: string,
    actor: string,
    opts?: DbAccess
  ): Promise<number> {
    try {
      if (!entryId) return 0;
      const result = await dutyDayRepository.softDeleteByEntryId(
        entryId,
        actor,
        opts
      );
      if (!result.success) {
        logFailure("softDeleteByEntryId", result.error);
        return 0;
      }
      return result.data || 0;
    } catch (err) {
      logFailure("syncSvcEntryDeleted", err);
      return 0;
    }
  },

  /**
   * Soft-delete every active day-row for a (svc_key, billing_id) slice that
   * isn't in `keepEntryIds`. Used after the `hominal_replace_service_entries`
   * RPC executes — it physically deletes the old svc_entries, so the only
   * way to know which day-rows are now orphaned is by ID diff.
   */
  async syncSvcKeyReplace(
    billingId: string,
    serviceName: string,
    keepEntryIds: string[],
    actor: string,
    opts?: DbAccess
  ): Promise<number> {
    try {
      if (!billingId) return 0;
      const keep = new Set((keepEntryIds || []).filter(Boolean));
      const db = resolveClient(opts);
      const lookup = await runListQuery<JsonRow>(
        () => {
          let q = db
            .from("hh_duty_days")
            .select("id, svc_entry_id")
            .eq("billing_id", billingId)
            .is("deleted_at", null);
          if (serviceName) q = q.eq("service_name", serviceName);
          return q;
        },
        "dutyDayLedger.syncSvcKeyReplace.lookup"
      );
      if (!lookup.success) {
        logFailure("syncSvcKeyReplace.lookup", lookup.error);
        return 0;
      }
      const orphanIds = (lookup.data || [])
        .filter((r) => !keep.has(String(r.svc_entry_id || "")))
        .map((r) => String(r.id));
      if (!orphanIds.length) return 0;
      const update = await runListQuery<JsonRow>(
        () =>
          db
            .from("hh_duty_days")
            .update({
              deleted_at: new Date().toISOString(),
              deleted_by: actor,
              updated_by: actor
            })
            .in("id", orphanIds)
            .is("deleted_at", null)
            .select("id"),
        "dutyDayLedger.syncSvcKeyReplace.update"
      );
      if (!update.success) {
        logFailure("syncSvcKeyReplace.update", update.error);
        return 0;
      }
      return (update.data || []).length;
    } catch (err) {
      logFailure("syncSvcKeyReplace", err);
      return 0;
    }
  }
};

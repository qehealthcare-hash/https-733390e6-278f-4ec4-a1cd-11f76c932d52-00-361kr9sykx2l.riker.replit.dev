/**
 * Billing service — corporate-grade layered facade.
 *
 * Composes /src/validation/billingValidation + /src/business/billingRules +
 * /src/database/billingRepository + /src/database/dutyRepository +
 * /src/database/auditRepository.
 *
 * Hardened rules (Phase 5 Billing):
 *   - All amounts and outstanding balances are computed server-side via
 *     `computeBillingTotals`. Frontend never recomputes a total.
 *   - One Active bill per patient is enforced by both the
 *     `uq_hh_billings_patient_active` DB index and `ensureActiveBilling`.
 *   - Closed / Cancelled bills are LOCKED. Edits, new service entries,
 *     receipts, and duty re-bills are blocked until the bill is reopened.
 *   - Reopening requires an explicit reason and is audited.
 *   - `generateFromDuty` validates the duty (must have patient, not
 *     cancelled), pins the bill to the duty's calendar period, and refuses
 *     to add duplicate svc entries.
 *   - `generateFromDutyRange` is idempotent: it can be re-run for the same
 *     YYYY-MM and only adds previously-unbilled duties.
 *   - Every mutation refetches the persisted row + writes an audit log.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import {
  billingSchema,
  billingStatusSchema,
  billingCloseSchema,
  billingReopenSchema,
  billingEditSchema,
  billingLegacySyncSchema,
  receiptSchema,
  replaceServiceEntriesSchema,
  generateFromDutySchema,
  generateFromDutyRangeSchema,
  generateInvoiceSchema,
  finalInvoiceSchema,
  billingListQuerySchema,
  type BillingInput,
  type BillingStatusInput,
  type BillingCloseInput,
  type BillingReopenInput,
  type BillingEditInput,
  type BillingLegacySyncInput,
  type ReceiptInput,
  type ReplaceServiceEntriesInput,
  type GenerateFromDutyInput,
  type GenerateFromDutyRangeInput,
  type GenerateInvoiceInput,
  type FinalInvoiceInput,
  type BillingListQuery,
  type BillingStatus
} from "@/validation/billingValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  amountForShift,
  billingCloseRow,
  billingPauseRow,
  billingPeriodOf,
  billingReopenRow,
  billingStatusRow,
  buildServiceEntryFromDuty,
  canBillDuty,
  canCloseBilling,
  canEditBilling,
  derivePaidStatus,
  billingPeriodsFromDates,
  invoiceOutstanding,
  type BillingPaidStatus,
  canReopenBilling,
  canTransitionTo,
  computeBillingTotals,
  dutyInPeriod,
  dutyRemarksKey,
  dutyServiceDate,
  isBillingClosed,
  periodFromServices,
  serviceKey,
  type BillingTotals
} from "@/business/billingRules";
import { assertNotStale } from "@/business/concurrencyRules";
import { businessFailure, businessOk } from "@/business/businessResult";
import { monthRangeUTC } from "@/business/dateRules";
import { receiptInYmdRange } from "@/business/reportRules";
import { newId } from "@/business/idRules";
import { billingRepository } from "@/database/billingRepository";
import { reportRepository } from "@/database/reportRepository";
import { patientRepository } from "@/database/patientRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
import { dutyDayLedger } from "@/services/dutyDayLedger";
import type { JsonRow } from "@/database/types";
import {
  duplicateFailure,
  failure,
  notFoundFailure,
  passFailure,
  success
} from "@/utils/apiResponse";

import type { ServiceActor } from "@/types/serviceActor";

/** @deprecated Import `ServiceActor` from `@/types/serviceActor`. */
export type ActorLike = ServiceActor;

export interface BillingServiceContext {
  actor: ServiceActor;
  accessToken?: string;
}

function dbAccess(ctx: BillingServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

export interface CapDutiesResult {
  duties_capped: number;
  duties_resumed: number;
  duties_processed: number;
  svc_pruned: number;
  payouts_pruned: number;
  errors: { duty_id: string; error: string }[];
  capped_end_at?: string;
  restored_end_at?: string;
}

/**
 * Cap or restore open-ended duties when a patient's bill flips status.
 *
 * Closing:
 *   - Run BEFORE the DB status changes so dutyDiaryService.materializeDuty
 *     still sees an Active bill and can reconcile + prune in one pass.
 *   - Walk every SCHEDULED / IN_PROGRESS duty for the patient. If end_at is
 *     open-ended (or further than today), set it to today and run a
 *     reconciling materialize so future diary rows get pruned.
 *
 * Reopening:
 *   - If a duty's end_at exactly matches the previous bill close date
 *     (or sits at the cap from a recent close), restore the open-ended
 *     sentinel so the daily extend cron resumes accrual automatically.
 */
async function capLinkedDutiesOnBillingClose(
  patientId: string,
  ctx: BillingServiceContext,
  mode: "close" | "reopen" = "close",
  prevCloseEndAt?: string
): Promise<CapDutiesResult> {
  const { isOpenEndedEndAt, openEndedSentinelFor } = await import("@/business/dutyRules");
  const { dutyDiaryService } = await import("@/services/dutyDiaryService");
  const { crmTodayEndIso, crmTodayIso } = await import("@/utils/crmToday");
  const todayDate = crmTodayIso();
  const cappedEnd = crmTodayEndIso();
  const out: CapDutiesResult = {
    duties_capped: 0,
    duties_resumed: 0,
    duties_processed: 0,
    svc_pruned: 0,
    payouts_pruned: 0,
    errors: []
  };

  const active = await dutyRepository.findActiveByPatient(patientId, dbAccess(ctx));
  if (!active.success || !active.data?.length) return out;

  for (const duty of active.data) {
    const dutyId = String(duty.id);
    out.duties_processed += 1;
    try {
      if (mode === "close") {
        const currentEnd = String(duty.end_at || "");
        const needsCap = isOpenEndedEndAt(currentEnd) || currentEnd > cappedEnd;
        if (needsCap) {
          const upd = await dutyRepository.update(
            dutyId,
            { end_at: cappedEnd, updated_by: ctx.actor.email },
            dbAccess(ctx)
          );
          if (!upd.success) {
            out.errors.push({ duty_id: dutyId, error: upd.error || "cap update failed" });
            continue;
          }
          out.duties_capped += 1;
          // Per-duty audit on cap so each duty's end_at change is queryable
          // (the summary capStamp on the billing audit is not).
          await writeMutationAudit(dbAccess(ctx), ctx.actor, {
            module: "duty",
            entity_id: dutyId,
            action: "update",
            stamp: `Capped on bill close · ${currentEnd || "(open)"} → ${cappedEnd}`,
            before: { end_at: currentEnd },
            after: { end_at: cappedEnd }
          }).catch((err) => {
            console.error("[capLinkedDutiesOnBillingClose] cap audit failed", err);
          });
        }
        // Only override end_at when we actually capped the duty. Passing
        // `cappedEnd` for a duty that already ended earlier would make
        // materializeDuty extend svc_entries past the real duty end —
        // billing phantom days the patient never received.
        const dutyForMaterialize = needsCap
          ? ({ ...duty, end_at: cappedEnd } as JsonRow)
          : (duty as JsonRow);
        const mat = await dutyDiaryService.materializeDuty(dutyForMaterialize, ctx);
        if (!mat.success) {
          out.errors.push({ duty_id: dutyId, error: mat.error || "materialize failed" });
          continue;
        }
        out.svc_pruned += mat.data?.deleted_svc ?? 0;
        out.payouts_pruned += mat.data?.deleted_payout ?? 0;
      } else {
        const currentEnd = String(duty.end_at || "").slice(0, 10);
        const capDay = (prevCloseEndAt || cappedEnd).slice(0, 10);
        // Resume only duties that were capped by a recent close (end matches
        // the cap day) and not a manually picked future date.
        if (!isOpenEndedEndAt(currentEnd) && currentEnd === capDay) {
          const sentinel = openEndedSentinelFor(String(duty.start_at || ""));
          const upd = await dutyRepository.update(
            dutyId,
            { end_at: sentinel, updated_by: ctx.actor.email },
            dbAccess(ctx)
          );
          if (!upd.success) {
            out.errors.push({ duty_id: dutyId, error: upd.error || "resume update failed" });
            continue;
          }
          out.duties_resumed += 1;
          await writeMutationAudit(dbAccess(ctx), ctx.actor, {
            module: "duty",
            entity_id: dutyId,
            action: "update",
            stamp: `Resumed on bill reopen · ${currentEnd} → open-ended`,
            before: { end_at: currentEnd },
            after: { end_at: sentinel }
          }).catch((err) => {
            console.error("[capLinkedDutiesOnBillingClose] resume audit failed", err);
          });
          const resumed = { ...duty, end_at: sentinel } as JsonRow;
          await dutyDiaryService.materializeDuty(resumed, ctx);
        }
      }
    } catch (err) {
      out.errors.push({
        duty_id: dutyId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  if (mode === "close") out.capped_end_at = cappedEnd;
  if (mode === "reopen") out.restored_end_at = prevCloseEndAt;
  return out;
}

async function fireAudit(
  ctx: BillingServiceContext,
  module: "billing" | "receipt" | "svc_entry",
  payload: {
    entity_id: string;
    action: "create" | "update" | "close" | "delete" | "soft-delete";
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module,
    entity_id: payload.entity_id,
    action: payload.action,
    stamp: payload.stamp,
    before: payload.before ?? null,
    after: payload.after ?? null
  });
}

type LoadResult<T> =
  | { success: true; data: T }
  | { success: false; error?: string; code?: string; details?: unknown };

function toLoadFailure(result: ApiResult<unknown>): LoadResult<never> {
  return {
    success: false,
    error: result.error,
    code: result.code,
    details: result.details
  };
}

async function loadBilling(
  id: string,
  ctx: BillingServiceContext
): Promise<LoadResult<JsonRow>> {
  const row = await billingRepository.findBillingById(id, dbAccess(ctx));
  if (!row.success) return toLoadFailure(row);
  if (!row.data) return toLoadFailure(notFoundFailure("Billing", id));
  return { success: true, data: row.data };
}

async function loadFreshBilling(
  id: string,
  ctx: BillingServiceContext,
  fallback?: JsonRow | null
): Promise<LoadResult<JsonRow>> {
  const refreshed = await billingRepository.findBillingById(id, dbAccess(ctx));
  if (!refreshed.success) return toLoadFailure(refreshed);
  const row = refreshed.data ?? fallback ?? null;
  if (!row) return toLoadFailure(failure("Billing not found after mutation", ErrorCodes.internal));
  return { success: true, data: row };
}

export interface InvoiceSummary {
  invoice: JsonRow;
  amount: number;
  received: number;
  outstanding: number;
  status: BillingPaidStatus | "CANCELLED";
}

export interface BillingWithTotals {
  billing: JsonRow;
  services: JsonRow[];
  receipts: JsonRow[];
  invoices: InvoiceSummary[];
  totals: BillingTotals;
  period: { from?: string; to?: string; months: string[] };
  /**
   * Patient snapshot for invoice / PDF headers. Joined from `hh_patients`
   * by `billing.patient_id`. Surface only the fields the UI prints — name,
   * phone, address — so we don't leak medical data through the billing
   * view.
   */
  patient: {
    id: string;
    name: string;
    phone: string;
    address: string;
    area: string;
    city: string;
    pincode: string;
  } | null;
}

function buildInvoiceSummaries(
  invoiceRows: JsonRow[],
  receipts: JsonRow[]
): InvoiceSummary[] {
  const receiptsByInvoice = new Map<string, number>();
  for (const r of receipts) {
    const invId = String(r.invoice_id || "");
    if (!invId) continue;
    receiptsByInvoice.set(
      invId,
      Number(receiptsByInvoice.get(invId) || 0) + Number(r.amount || 0)
    );
  }

  const activeInvoices = invoiceRows.filter(
    (inv) => String(inv.status || "").toUpperCase() !== "CANCELLED"
  );

  // FINAL invoices with `amount = 0` can carry deposit / refund receipts
  // (see `hominal_generate_final_invoice` v3 — when all svc_entries were
  // already snapshotted into a MONTHLY invoice, the FINAL is opened at
  // gross 0 but the Security deposit receipt is still attached to it).
  // For display we redistribute that overpayment to the oldest unpaid
  // sibling invoice on the same bill, so:
  //   * MONTHLY shows the deposit credit instead of a phantom outstanding
  //   * FINAL no longer shows "received > amount"
  //   * Σ(per-invoice outstanding) matches the bill-level outstanding.
  // DB rows are untouched — this is purely the view layer for the table.
  const overflow = new Map<string, number>();
  for (const inv of activeInvoices) {
    const id = String(inv.id);
    const amount = Number(inv.amount || 0);
    const rawReceived = Number(receiptsByInvoice.get(id) || 0);
    const over = rawReceived - Math.max(0, amount);
    if (over > 0) {
      overflow.set(id, over);
    }
  }

  if (overflow.size > 0) {
    // Oldest non-overflow invoice first (FIFO settles older balances first).
    const sortKey = (inv: JsonRow): string =>
      String(inv.created_at || inv.from_date || inv.period || inv.id || "");
    const unpaidTargets = activeInvoices
      .filter((inv) => !overflow.has(String(inv.id)))
      .slice()
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    overflow.forEach((overAmount, sourceId) => {
      let remaining = overAmount;
      for (const target of unpaidTargets) {
        if (remaining <= 0) break;
        const tid = String(target.id);
        const tAmount = Number(target.amount || 0);
        if (tAmount <= 0) continue;
        const tReceived = Number(receiptsByInvoice.get(tid) || 0);
        const room = tAmount - tReceived;
        if (room <= 0) continue;
        const apply = Math.min(room, remaining);
        receiptsByInvoice.set(tid, tReceived + apply);
        remaining -= apply;
      }
      const sourceReceived = Number(receiptsByInvoice.get(sourceId) || 0);
      receiptsByInvoice.set(sourceId, sourceReceived - (overAmount - remaining));
    });
  }

  return activeInvoices.map((inv) => {
    const id = String(inv.id);
    const amount = Number(inv.amount || 0);
    const received = Number(receiptsByInvoice.get(id) || 0);
    const outstanding = invoiceOutstanding(amount, received);
    const persisted = String(inv.status || "").toUpperCase();
    const status = derivePerInvoiceStatus(persisted, amount, received, outstanding);
    return { invoice: inv, amount, received, outstanding, status };
  });
}

/**
 * Per-invoice paid status. Was previously `amount <= 0 || received <= 0
 * => UNPAID`, which incorrectly flagged settled FINAL invoices as unpaid:
 *  - FINAL invoices with `amount = 0` carry the Security deposit receipt
 *    (after the overflow redistribution above moves it onto the MONTHLY).
 *    Such a FINAL has nothing left to collect and should display as PAID.
 *  - A FINAL with no work and no deposit is also a closing no-op — PAID.
 *
 * Rules:
 *  - persisted CANCELLED                → CANCELLED
 *  - amount == 0                        → PAID  (closing / no-op doc)
 *  - amount  > 0, received >= amount    → PAID
 *  - amount  > 0, 0 < received < amount → PARTIAL
 *  - amount  > 0, received <= 0         → UNPAID
 */
function derivePerInvoiceStatus(
  persisted: string,
  amount: number,
  received: number,
  _outstanding: number
): InvoiceSummary["status"] {
  if (persisted === "CANCELLED") return "CANCELLED";
  if (amount <= 0) return "PAID";
  if (received >= amount) return "PAID";
  if (received > 0) return "PARTIAL";
  return "UNPAID";
}

/** Refuse svc mutations for months that already have a MONTHLY invoice. */
async function assertNoMonthlyInvoiceLock(
  billingId: string,
  dates: string[],
  access: ReturnType<typeof dbAccess>
): Promise<ApiResult<null>> {
  const periods = billingPeriodsFromDates(dates);
  for (const period of periods) {
    const existing = await billingRepository.findInvoiceForPeriod(billingId, period, access);
    if (!existing.success) return passFailure(existing);
    if (existing.data) {
      const invNo = String(existing.data.invoice_no || existing.data.id);
      return businessFailure(
        `Period ${period} already has invoice ${invNo} — delete or regenerate that invoice before changing service entries`,
        { period, invoice_id: existing.data.id, invoice_no: invNo }
      );
    }
  }
  return businessOk();
}

/**
 * Recompute and persist paid_status on hh_billings based on current totals.
 */
async function recomputePaidStatus(
  billingId: string,
  ctx: BillingServiceContext
): Promise<LoadResult<BillingPaidStatus>> {
  const bundle = await loadBundleWithTotals(billingId, ctx);
  if (!bundle.success) {
    return { success: false, error: bundle.error, code: bundle.code, details: bundle.details };
  }
  const next = derivePaidStatus(bundle.data.totals);
  const current = String(bundle.data.billing.paid_status || "");
  if (current === next) return { success: true, data: next };
  const updated = await billingRepository.updateBilling(
    billingId,
    { paid_status: next, updated_by: ctx.actor.email },
    dbAccess(ctx)
  );
  if (!updated.success) {
    return {
      success: false,
      error: updated.error || "Could not update paid_status",
      code: updated.code,
      details: updated.details
    };
  }
  await fireAudit(ctx, "billing", {
    entity_id: billingId,
    action: "update",
    before: { paid_status: current },
    after: { paid_status: next },
    stamp: `Bill paid_status ${current || "—"} → ${next}`
  });
  return { success: true, data: next };
}

/**
 * Recompute and persist an invoice's status from its linked receipts.
 * UNPAID  → no receipts (or amount <= 0)
 * PARTIAL → some receipts, not enough
 * PAID    → received >= amount
 * CANCELLED bills are not touched.
 */
async function recomputeInvoiceStatus(
  invoiceId: string,
  ctx: BillingServiceContext
): Promise<LoadResult<BillingPaidStatus | "CANCELLED">> {
  const access = dbAccess(ctx);
  const invoice = await billingRepository.findInvoiceById(invoiceId, access);
  if (!invoice.success || !invoice.data) {
    return { success: false, error: "Invoice not found", code: ErrorCodes.notFound };
  }
  if (String(invoice.data.status || "").toUpperCase() === "CANCELLED") {
    return { success: true, data: "CANCELLED" };
  }
  const receipts = await billingRepository.listReceiptsByInvoice(invoiceId, access);
  if (!receipts.success) {
    return { success: false, error: receipts.error, code: receipts.code };
  }
  const amount = Number(invoice.data.amount || 0);
  const received = (receipts.data || []).reduce(
    (sum, r) => sum + Number(r.amount || 0),
    0
  );
  // Mirrors `derivePerInvoiceStatus` (view layer). A ₹0 closing invoice is
  // settled by definition; otherwise classify by received vs amount.
  let next: BillingPaidStatus;
  if (amount <= 0) next = "PAID";
  else if (received >= amount) next = "PAID";
  else if (received > 0) next = "PARTIAL";
  else next = "UNPAID";

  const current = String(invoice.data.status || "");
  if (current !== next) {
    const updated = await billingRepository.updateInvoice(
      invoiceId,
      { status: next, updated_by: ctx.actor.email },
      access
    );
    if (!updated.success) {
      return {
        success: false,
        error: updated.error || "Could not update invoice status",
        code: updated.code,
        details: updated.details
      };
    }
    await fireAudit(ctx, "billing", {
      entity_id: invoiceId,
      action: "update",
      before: { status: current },
      after: { status: next },
      stamp: `Invoice ${invoice.data.invoice_no || invoiceId} status ${current || "—"} → ${next}`
    });
  }
  return { success: true, data: next };
}

/** Load a billing bundle (billing + svc + receipts) and compute server-side totals. */
async function loadBundleWithTotals(
  billingId: string,
  ctx: BillingServiceContext
): Promise<LoadResult<BillingWithTotals>> {
  const bundle = await billingRepository.loadBillingBundle(billingId, dbAccess(ctx));
  if (!bundle.success) return toLoadFailure(bundle);
  const billing = bundle.data?.billing;
  if (!billing) return toLoadFailure(notFoundFailure("Billing", billingId));
  const services = bundle.data?.services || [];
  const receipts = bundle.data?.receipts || [];
  const totals = computeBillingTotals({
    services,
    receipts,
    secDep: Number(billing.sec_dep || 0)
  });

  // Best-effort patient lookup — if it fails (404, schema drift, etc.) we
  // still return the bill so the rest of the UI keeps working.
  let patientSummary: BillingWithTotals["patient"] = null;
  const patientId = String(billing.patient_id || "");
  if (patientId) {
    const patientResult = await patientRepository.findById(patientId, dbAccess(ctx));
    if (patientResult.success && patientResult.data) {
      const p = patientResult.data;
      patientSummary = {
        id: String(p.id ?? patientId),
        name: String(p.full_name ?? p.name ?? "").trim(),
        phone: String(p.mobile ?? p.phone ?? "").trim(),
        address: String(p.address ?? p.addr ?? "").trim(),
        area: String(p.area ?? "").trim(),
        city: String(p.city ?? "").trim(),
        pincode: String(p.pincode ?? p.pin ?? "").trim()
      };
    }
  }

  // Per-period invoices for this bill. We compute received-per-invoice
  // from the bill's receipt set (cheaper than per-invoice round-trips and
  // keeps the bundle one Supabase call per child table).
  const invoicesRes = await billingRepository.listInvoicesByBilling(
    billingId,
    dbAccess(ctx)
  );
  const invoiceRows = invoicesRes.success ? invoicesRes.data || [] : [];
  const invoices = buildInvoiceSummaries(invoiceRows, receipts);

  return {
    success: true,
    data: {
      billing,
      services,
      receipts,
      invoices,
      totals,
      period: periodFromServices(services),
      patient: patientSummary
    }
  };
}

/**
 * Ensure exactly one Active bill exists for a patient. Returns the existing
 * Active row if any, otherwise inserts a new one. Race-safe against the
 * `uq_hh_billings_patient_active` index — on conflict we re-read.
 */
async function ensureActiveBilling(
  patientId: string,
  ctx: BillingServiceContext
): Promise<LoadResult<JsonRow>> {
  const access = dbAccess(ctx);
  const existing = await billingRepository.findActiveByPatient(patientId, access);
  if (!existing.success) return toLoadFailure(existing);
  if (existing.data) return { success: true, data: existing.data };

  const id = newId.billing();
  const inserted = await billingRepository.insertBilling(
    {
      id,
      patient_id: patientId,
      status: "Active",
      paid_status: "UNPAID",
      sec_dep: 0,
      created: new Date().toISOString(),
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    },
    access
  );
  if (!inserted.success) {
    const msg = (inserted.error || "").toLowerCase();
    if (msg.includes("uq_hh_billings_patient_active") || msg.includes("duplicate key value")) {
      const retry = await billingRepository.findActiveByPatient(patientId, access);
      if (retry.success && retry.data) return { success: true, data: retry.data };
    }
    return toLoadFailure(inserted);
  }
  if (!inserted.data) {
    return toLoadFailure(failure("Billing insert returned no row", ErrorCodes.internal));
  }
  const finalized = finalizeWithAudit(
    await fireAudit(ctx, "billing", {
      entity_id: id,
      action: "create",
      after: inserted.data,
      stamp: `Bill created for patient ${patientId}`
    }),
    inserted.data
  );
  if (!finalized.success) return toLoadFailure(finalized);
  return { success: true, data: inserted.data };
}

export const billingService = {
  // ─────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────

  async list(
    rawQuery: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<{ rows: JsonRow[]; total: number }>> {
    const parsed = parseInput(billingListQuerySchema, rawQuery);
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as BillingListQuery;

    const access = dbAccess(ctx);

    let periodWindow: { startYMD: string; endYMD: string; startISO: string; endISO: string } | null =
      null;
    let rows: JsonRow[] = [];
    let listTotal = 0;

    if (query.period) {
      const w = monthRangeUTC(query.period);
      periodWindow = {
        startYMD: w.startISO.slice(0, 10),
        endYMD: w.endISO.slice(0, 10),
        startISO: w.startISO,
        endISO: w.endISO
      };
      const [svcRes, rcptRes] = await Promise.all([
        reportRepository.listServicesInRange(
          periodWindow.startYMD,
          periodWindow.endYMD,
          { patient_id: query.patient_id },
          access
        ),
        reportRepository.listReceiptsInRange(
          periodWindow.startISO,
          periodWindow.endISO,
          { patient_id: query.patient_id },
          access
        )
      ]);
      if (!svcRes.success) return passFailure(svcRes);
      if (!rcptRes.success) return passFailure(rcptRes);
      const activeIds = new Set<string>();
      for (const s of svcRes.data || []) {
        const id = String(s.billing_id || "");
        if (id) activeIds.add(id);
      }
      for (const r of rcptRes.data || []) {
        const id = String(r.billing_id || "");
        if (id) activeIds.add(id);
      }
      if (!activeIds.size) return success({ rows: [], total: 0 });
      const byIds = await billingRepository.listBillingsByIds([...activeIds], access);
      if (!byIds.success) return passFailure(byIds);
      const term = (query.q || "").trim().toLowerCase();
      rows = (byIds.data || []).filter((b) => {
        if (query.patient_id && String(b.patient_id || "") !== query.patient_id) return false;
        if (query.status && String(b.status || "") !== query.status) return false;
        if (!term) return true;
        const hay = [b.id, b.patient_id, b.status]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        return hay.includes(term);
      });
      listTotal = rows.length;
      rows = rows.slice(query.offset, query.offset + query.limit);
    } else {
      const result = await billingRepository.listBillings(
        {
          limit: query.limit,
          offset: query.offset,
          q: query.q,
          patient_id: query.patient_id,
          status: query.status
        },
        access
      );
      if (!result.success) return passFailure(result);
      rows = result.data?.rows || [];
      listTotal = result.data?.total ?? 0;
    }

    const billingIds = rows.map((r) => String(r.id));
    const patientIds = Array.from(
      new Set(rows.map((r) => String(r.patient_id || "")).filter(Boolean))
    );

    const [allSvc, allReceipts, patientsRes] = await Promise.all([
      billingRepository.listSvcByBillingIds(billingIds, access),
      billingRepository.listActiveReceiptsByBillingIds(billingIds, access),
      patientRepository.findByIds(patientIds, access)
    ]);
    if (!allSvc.success) return passFailure(allSvc);
    if (!allReceipts.success) return passFailure(allReceipts);
    if (!patientsRes.success) return passFailure(patientsRes);

    const svcByBilling = new Map<string, JsonRow[]>();
    for (const s of allSvc.data || []) {
      const bid = String(s.billing_id || "");
      if (!svcByBilling.has(bid)) svcByBilling.set(bid, []);
      svcByBilling.get(bid)!.push(s);
    }
    const receiptsByBilling = new Map<string, JsonRow[]>();
    for (const r of allReceipts.data || []) {
      const bid = String(r.billing_id || "");
      if (!receiptsByBilling.has(bid)) receiptsByBilling.set(bid, []);
      receiptsByBilling.get(bid)!.push(r);
    }
    const patientMap = new Map<string, { name: string; phone: string }>();
    for (const p of patientsRes.data || []) {
      const pid = String(p.id || "");
      patientMap.set(pid, {
        name: String(p.full_name || p.name || "").trim(),
        phone: String(p.mobile || p.phone || "").trim()
      });
    }

    const enriched = rows.map((b) => {
        const id = String(b.id);
        let services = svcByBilling.get(id) || [];
        let receipts = receiptsByBilling.get(id) || [];
        if (periodWindow) {
          services = services.filter(
            (s) =>
              String(s.date || "") >= periodWindow!.startYMD &&
              String(s.date || "") < periodWindow!.endYMD
          );
          receipts = receipts.filter((r) =>
            receiptInYmdRange(
              r,
              periodWindow!.startYMD,
              periodWindow!.endYMD,
              periodWindow!.startISO,
              periodWindow!.endISO
            )
          );
        }
        const totals = computeBillingTotals({
          services,
          receipts,
          secDep: Number(b.sec_dep || 0)
        });
        const patient = patientMap.get(String(b.patient_id || "")) || null;
        return {
          ...b,
          patient_name: patient?.name || "",
          patient_phone: patient?.phone || "",
          totals,
          paid_status:
            (b.paid_status as string | null) ||
            derivePaidStatus(totals)
        };
      });

    return success({
      rows: enriched,
      total: listTotal
    });
  },

  /**
   * All billings for a patient + their svc entries + receipts + totals. The
   * legacy CRM expects this shape — we keep the contract but totals now come
   * from `computeBillingTotals`.
   */
  async listByPatient(
    patientId: string,
    ctx: BillingServiceContext
  ): Promise<
    ApiResult<{
      billings: JsonRow[];
      receipts: JsonRow[];
      services: JsonRow[];
      invoices: InvoiceSummary[];
      totalsByBilling: Record<string, BillingTotals>;
    }>
  > {
    if (!patientId) {
      return failure("patient_id is required", ErrorCodes.badRequest);
    }
    const access = dbAccess(ctx);
    const billings = await billingRepository.listBillingsByPatient(patientId, access);
    if (!billings.success) return passFailure(billings);
    const billingRows = billings.data || [];
    const billingIdList = billingRows.map((b) => String(b.id));
    const billingIds = new Set(billingIdList);

    const [allReceipts, allSvc, invoiceRows] = await Promise.all([
      billingRepository.listAllReceipts(access),
      billingRepository.listSvcByBillingIds(billingIdList, access),
      billingRepository.listInvoicesByPatient(patientId, access)
    ]);
    if (!allReceipts.success) return passFailure(allReceipts);
    if (!allSvc.success) return passFailure(allSvc);
    if (!invoiceRows.success) return passFailure(invoiceRows);

    const receipts = (allReceipts.data || []).filter((r) =>
      billingIds.has(String(r.billing_id || ""))
    );
    const services = allSvc.data || [];

    const totalsByBilling: Record<string, BillingTotals> = {};
    for (const b of billingRows) {
      const id = String(b.id);
      totalsByBilling[id] = computeBillingTotals({
        services: services.filter((s) => String(s.billing_id) === id),
        receipts: receipts.filter((r) => String(r.billing_id) === id),
        secDep: Number(b.sec_dep || 0)
      });
    }

    const invoices = buildInvoiceSummaries(invoiceRows.data || [], receipts);

    return success({
      billings: billingRows,
      receipts,
      services,
      invoices,
      totalsByBilling
    });
  },

  async getById(
    id: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<BillingWithTotals>> {
    const bundle = await loadBundleWithTotals(id, ctx);
    if (!bundle.success) {
      return failure(bundle.error || "Billing not found", bundle.code, bundle.details);
    }
    return success(bundle.data);
  },

  /** Refetch endpoint used by the UI after every mutation. */
  async invoicePayload(
    billingId: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<BillingWithTotals>> {
    const bundle = await loadBundleWithTotals(billingId, ctx);
    if (!bundle.success) {
      return failure(bundle.error || "Billing not found", bundle.code, bundle.details);
    }
    return success(bundle.data);
  },

  // ─────────────────────────────────────────────────────────────────────
  // Writes
  // ─────────────────────────────────────────────────────────────────────

  async create(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(billingSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as BillingInput;
    const ensured = await ensureActiveBilling(input.patient_id, ctx);
    if (!ensured.success) {
      return failure(ensured.error || "Could not ensure billing", ensured.code, ensured.details);
    }
    return success(ensured.data);
  },

  async update(
    id: string,
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const existing = await loadBilling(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Billing not found", existing.code, existing.details);
    }

    const editGuard = canEditBilling(String(existing.data.status || ""));
    if (!editGuard.success) {
      return failure(editGuard.error || "Bill locked", editGuard.code, editGuard.details);
    }

    const parsed = parseInput(billingEditSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as BillingEditInput;

    const stale = assertNotStale(
      "Billing",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!stale.success) return passFailure(stale);

    const patch: JsonRow = {};
    if (input.sec_dep !== undefined) patch.sec_dep = input.sec_dep;

    const updated = await billingRepository.updateBilling(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshBilling(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data
      }),
      fresh.data
    );
  },

  async setStatus(
    id: string,
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const existing = await loadBilling(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Billing not found", existing.code, existing.details);
    }

    const parsed = parseInput(billingStatusSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as BillingStatusInput;

    const transition = canTransitionTo(String(existing.data.status || ""), input.status);
    if (!transition.success) {
      return failure(
        transition.error || "Illegal status transition",
        transition.code,
        transition.details
      );
    }

    const stale = assertNotStale(
      "Billing",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!stale.success) return passFailure(stale);

    const patch = billingStatusRow(input.status, ctx.actor.email);
    const updated = await billingRepository.updateBilling(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshBilling(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: `Status -> ${input.status}`
      }),
      fresh.data
    );
  },

  /**
   * Close a billing — requires at least one service entry and (unless
   * `force=true`) outstanding == 0.
   */
  async close(
    id: string,
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<BillingWithTotals>> {
    const existing = await loadBilling(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Billing not found", existing.code, existing.details);
    }

    if (isBillingClosed(String(existing.data.status || ""))) {
      const bundle = await loadBundleWithTotals(id, ctx);
      if (!bundle.success) {
        return failure(bundle.error || "Billing not found", bundle.code, bundle.details);
      }
      return success(bundle.data);
    }

    const parsed = parseInput(billingCloseSchema, rawInput ?? {});
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as BillingCloseInput;

    const bundle = await loadBundleWithTotals(id, ctx);
    if (!bundle.success) {
      return failure(bundle.error || "Billing not found", bundle.code, bundle.details);
    }

    const guard = canCloseBilling(
      bundle.data.totals,
      bundle.data.services.length,
      input.force
    );
    if (!guard.success) {
      return failure(guard.error || "Cannot close bill", guard.code, guard.details);
    }

    // P0 ordering: cap + prune linked duty diary rows BEFORE flipping the
    // bill to Closed, so dutyDiaryService.materializeDuty still sees an
    // Active bill (its own guard refuses to write to a Closed bill).
    //
    // Hardening (audit follow-up):
    //   1. After capping, re-run loadBundleWithTotals + canCloseBilling so
    //      pruning future svc rows can't accidentally pass an
    //      already-failed guard. (In practice cap reduces totals, so a
    //      passing pre-check stays passing — this is a defence in depth.)
    //   2. If the status-flip update fails, attempt to restore the duty
    //      windows so we don't end up with shortened diaries AND an Active
    //      bill (operator confusion + financial drift).
    const patientId = String(existing.data.patient_id || "");
    let capSummary: CapDutiesResult | null = null;
    if (patientId) {
      try {
        capSummary = await capLinkedDutiesOnBillingClose(patientId, ctx, "close");
        if (capSummary.errors.length) {
          await writeMutationAudit(dbAccess(ctx), ctx.actor, {
            module: "billing",
            entity_id: id,
            action: "update",
            stamp: `Cap-on-close partial failure (${capSummary.errors.length} duties)`,
            before: null,
            after: capSummary
          });
        }
      } catch (err) {
        console.error("[billingService.close] cap linked duties failed", err);
        await writeMutationAudit(dbAccess(ctx), ctx.actor, {
          module: "billing",
          entity_id: id,
          action: "update",
          stamp: `Cap-on-close threw: ${err instanceof Error ? err.message : String(err)}`,
          before: null,
          after: null
        });
      }
    }

    // Auto-raise the FINAL closing invoice (deposit applied as a Security
    // receipt against the new invoice) BEFORE the post-cap guard runs, so
    // outstanding drops and close can succeed without force when the deposit
    // covers the bill. Idempotent — repeat close attempts reuse the FINAL.
    // Best-effort: "nothing to finalize" is treated as a no-op so closing
    // a bill that already has everything invoiced + no deposit still
    // succeeds.
    let finalInvoiceSummary: {
      invoice_no?: string;
      sec_dep_applied: number;
      gross: number;
      net: number;
      refund_amount: number;
    } | null = null;
    try {
      const finalRes = await this.generateFinalInvoice({ billing_id: id }, ctx);
      if (finalRes.success && finalRes.data) {
        finalInvoiceSummary = {
          invoice_no: String(finalRes.data.invoice.invoice_no || ""),
          sec_dep_applied: Number(finalRes.data.sec_dep_applied || 0),
          gross: Number(finalRes.data.gross || 0),
          net: Number(finalRes.data.net || 0),
          refund_amount: Number(finalRes.data.refund_amount || 0)
        };
      } else if (!finalRes.success) {
        const msg = String(finalRes.error || "").toLowerCase();
        if (!msg.includes("nothing to finalize")) {
          return failure(
            finalRes.error || "Could not raise FINAL invoice before close",
            finalRes.code,
            finalRes.details
          );
        }
      }
    } catch (err) {
      console.error("[billingService.close] FINAL invoice generation threw", err);
      return failure(
        `Could not raise FINAL invoice before close: ${
          err instanceof Error ? err.message : String(err)
        }`,
        ErrorCodes.internal
      );
    }

    // Re-validate against the post-cap + post-FINAL snapshot. If the cap
    // removed every svc row (edge case: open-ended duty had no past-day
    // entries), the guard's services-count check would now fail — return
    // a clean error. The guard also sees the deposit already applied
    // (FINAL invoice's credit line + zeroed sec_dep), so a bill whose
    // deposit covers the remaining services closes cleanly.
    const postCap = await loadBundleWithTotals(id, ctx);
    if (!postCap.success) {
      return failure(postCap.error || "Post-cap refetch failed", postCap.code, postCap.details);
    }
    const postCapGuard = canCloseBilling(
      postCap.data.totals,
      postCap.data.services.length,
      input.force
    );
    if (!postCapGuard.success) {
      const guardDetails =
        postCapGuard.details && typeof postCapGuard.details === "object"
          ? { ...(postCapGuard.details as Record<string, unknown>) }
          : postCapGuard.details !== undefined
            ? { reason: postCapGuard.details }
            : {};
      if (finalInvoiceSummary) {
        (guardDetails as Record<string, unknown>).final_invoice = finalInvoiceSummary;
      }
      return failure(
        postCapGuard.error || "Cannot close bill after diary cap",
        postCapGuard.code,
        Object.keys(guardDetails).length ? guardDetails : undefined
      );
    }

    const closePatch = billingCloseRow(ctx.actor.email, input.reason, input.close_reason_other);
    const flipped = await billingRepository.flipBillingStatusRpc(
      id,
      "Closed",
      ctx.actor.email,
      String(closePatch.closed_at || new Date().toISOString()),
      dbAccess(ctx)
    );
    if (!flipped.success) {
      return passFailure(flipped);
    }
    const flipBody = flipped.data;
    if (!flipBody?.ok) {
      const code =
        flipBody?.code === "duplicate"
          ? ErrorCodes.duplicate
          : flipBody?.code === "conflict"
            ? ErrorCodes.conflict
            : ErrorCodes.business;
      // Compensating rollback when the atomic status flip fails.
      if (patientId && capSummary && capSummary.duties_capped > 0) {
        try {
          const prevCloseEnd = capSummary.capped_end_at || new Date().toISOString();
          const restore = await capLinkedDutiesOnBillingClose(
            patientId,
            ctx,
            "reopen",
            prevCloseEnd
          );
          await writeMutationAudit(dbAccess(ctx), ctx.actor, {
            module: "billing",
            entity_id: id,
            action: "update",
            stamp: `Close flip FAILED — rolled back cap (resumed:${restore.duties_resumed})`,
            before: capSummary,
            after: restore
          });
        } catch (err) {
          console.error("[billingService.close] compensating rollback failed", err);
        }
      }
      return failure(
        flipBody?.message || "Could not close bill — refresh and retry",
        code,
        flipBody
      );
    }
    if (!flipBody.billing) {
      if (patientId && capSummary && capSummary.duties_capped > 0) {
        try {
          const prevCloseEnd = capSummary.capped_end_at || new Date().toISOString();
          await capLinkedDutiesOnBillingClose(patientId, ctx, "reopen", prevCloseEnd);
        } catch (err) {
          console.error("[billingService.close] compensating rollback failed", err);
        }
      }
      return failure("Billing close returned no row", ErrorCodes.internal);
    }

    const refreshed = await loadBundleWithTotals(id, ctx);
    if (!refreshed.success) {
      return failure(refreshed.error || "Refetch failed", refreshed.code, refreshed.details);
    }

    const capStamp = capSummary
      ? ` · duties:${capSummary.duties_processed} capped:${capSummary.duties_capped} svc-pruned:${capSummary.svc_pruned} payouts-pruned:${capSummary.payouts_pruned}${capSummary.errors.length ? ` errors:${capSummary.errors.length}` : ""}`
      : "";
    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: id,
        action: "close",
        before: existing.data,
        after: refreshed.data.billing,
        stamp: `Closed${input.reason ? `: ${input.reason}` : ""}${input.force ? " (force)" : ""}${capStamp}`
      }),
      refreshed.data
    );
  },

  async reopen(
    id: string,
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<BillingWithTotals>> {
    const existing = await loadBilling(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Billing not found", existing.code, existing.details);
    }

    const parsed = parseInput(billingReopenSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as BillingReopenInput;

    const guard = canReopenBilling(String(existing.data.status || ""));
    if (!guard.success) {
      return failure(guard.error || "Cannot reopen bill", guard.code, guard.details);
    }

    // Refuse if there's already an Active bill for the same patient (would
    // violate `uq_hh_billings_patient_active`).
    const active = await billingRepository.findActiveByPatient(
      String(existing.data.patient_id || ""),
      dbAccess(ctx)
    );
    if (!active.success) return passFailure(active);
    if (active.data && String(active.data.id) !== id) {
      return duplicateFailure(
        "patient_id",
        existing.data.patient_id,
        "Patient already has another Active bill — close it before reopening this one"
      );
    }

    const flipped = await billingRepository.flipBillingStatusRpc(
      id,
      "Active",
      ctx.actor.email,
      null,
      dbAccess(ctx)
    );
    if (!flipped.success) return passFailure(flipped);
    const flipBody = flipped.data;
    if (!flipBody?.ok) {
      const code =
        flipBody?.code === "duplicate"
          ? ErrorCodes.duplicate
          : flipBody?.code === "conflict"
            ? ErrorCodes.conflict
            : ErrorCodes.business;
      return failure(
        flipBody?.message || "Could not reopen bill — refresh and retry",
        code,
        flipBody
      );
    }

    // Restore open-ended accrual for any duty whose end_at was capped at
    // the bill's previous close timestamp. Best-effort: failures get
    // audited but don't unwind the reopen. We prefer the new `closed_at`
    // column over `updated_at` (which moves on every subsequent edit and
    // therefore failed to match the actual cap day after any post-close
    // mutation).
    const patientId = String(existing.data.patient_id || "");
    let resumeSummary: CapDutiesResult | null = null;
    if (patientId) {
      try {
        const prevCloseEnd = String(
          existing.data.closed_at || existing.data.updated_at || ""
        );
        resumeSummary = await capLinkedDutiesOnBillingClose(
          patientId,
          ctx,
          "reopen",
          prevCloseEnd
        );
        if (resumeSummary.errors.length) {
          await writeMutationAudit(dbAccess(ctx), ctx.actor, {
            module: "billing",
            entity_id: id,
            action: "update",
            stamp: `Resume-on-reopen partial failure (${resumeSummary.errors.length} duties)`,
            before: null,
            after: resumeSummary
          });
        }
      } catch (err) {
        console.error("[billingService.reopen] resume linked duties failed", err);
      }
    }

    const refreshed = await loadBundleWithTotals(id, ctx);
    if (!refreshed.success) {
      return failure(refreshed.error || "Refetch failed", refreshed.code, refreshed.details);
    }

    const resumeStamp = resumeSummary && resumeSummary.duties_resumed
      ? ` · duties-resumed:${resumeSummary.duties_resumed}`
      : "";
    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: refreshed.data.billing,
        stamp: `Reopened: ${input.reason}${resumeStamp}`
      }),
      refreshed.data
    );
  },

  // ─────────────────────────────────────────────────────────────────────
  // Duty linkage
  // ─────────────────────────────────────────────────────────────────────

  async generateFromDuty(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<
    ApiResult<{
      billing_id: string;
      svc_entry: JsonRow | null;
      duplicate: boolean;
      totals: BillingTotals;
    }>
  > {
    const parsed = parseInput(generateFromDutySchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as GenerateFromDutyInput;
    const access = dbAccess(ctx);

    const duty = await dutyRepository.findById(input.duty_id, access);
    if (!duty.success) return passFailure(duty);
    if (!duty.data) return notFoundFailure("Duty", input.duty_id);

    const dutyRow = duty.data;
    if (!dutyInPeriod(String(dutyRow.start_at || ""), input.period)) {
      return failure(
        `Duty is outside the requested billing period ${input.period}`,
        ErrorCodes.badRequest,
        { duty_period: billingPeriodOf(String(dutyRow.start_at || "")), requested: input.period }
      );
    }

    // Pre-check duty linkage — if already linked, refuse if the linked bill is Closed.
    let linkedStatus: string | null = null;
    if (dutyRow.billing_id) {
      const linked = await billingRepository.findBillingById(
        String(dutyRow.billing_id),
        access
      );
      if (!linked.success) return passFailure(linked);
      linkedStatus = String(linked.data?.status || "");
    }
    const linkGuard = canBillDuty(
      {
        billing_id: (dutyRow.billing_id as string | null) ?? null,
        status: (dutyRow.status as string | null) ?? null,
        patient_id: (dutyRow.patient_id as string | null) ?? null
      },
      linkedStatus
    );
    if (!linkGuard.success) {
      return failure(linkGuard.error || "Cannot bill duty", linkGuard.code, linkGuard.details);
    }

    // Already-linked + active bill: return the existing svc entry (duplicate=true).
    if (dutyRow.billing_id) {
      const dup = await billingRepository.findSvcByDutyRemark(
        String(dutyRow.billing_id),
        String(dutyRow.id),
        access
      );
      if (!dup.success) return passFailure(dup);
      if (dup.data) {
        const totals = await loadBundleWithTotals(String(dutyRow.billing_id), ctx);
        if (!totals.success) {
          return failure(totals.error || "Refetch failed", totals.code, totals.details);
        }
        return success({
          billing_id: String(dutyRow.billing_id),
          svc_entry: dup.data,
          duplicate: true,
          totals: totals.data.totals
        });
      }
    }

    const ensured = await ensureActiveBilling(String(dutyRow.patient_id), ctx);
    if (!ensured.success) {
      return failure(ensured.error || "Could not ensure billing", ensured.code, ensured.details);
    }
    const billingRow = ensured.data;
    const billingId = String(billingRow.id);

    const editGuard = canEditBilling(String(billingRow.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Active bill is locked",
        editGuard.code,
        editGuard.details
      );
    }

    // Per-billing duplicate guard (date + service_name) — protects against
    // two duties on the same day overwriting each other in the UI.
    const sameDay = await billingRepository.findSvcDuplicate(
      billingId,
      dutyServiceDate(String(dutyRow.start_at || "")),
      input.service_name,
      access
    );
    if (!sameDay.success) return passFailure(sameDay);
    if (sameDay.data) {
      // If that duplicate is for *this* duty, treat as idempotent.
      const sameDuty = await billingRepository.findSvcByDutyRemark(
        billingId,
        String(dutyRow.id),
        access
      );
      if (sameDuty.success && sameDuty.data) {
        const totals = await loadBundleWithTotals(billingId, ctx);
        if (!totals.success) {
          return failure(totals.error || "Refetch failed", totals.code, totals.details);
        }
        return success({
          billing_id: billingId,
          svc_entry: sameDuty.data,
          duplicate: true,
          totals: totals.data.totals
        });
      }
      return duplicateFailure(
        "svc_key",
        serviceKey(String(dutyRow.patient_id), input.service_name),
        "A bill already exists for this patient + service + date"
      );
    }

    const amount = amountForShift(String(dutyRow.shift_type || "DAY"), input.rate_overrides);
    const row = buildServiceEntryFromDuty({
      dutyId: String(dutyRow.id),
      patientId: String(dutyRow.patient_id),
      billingId,
      employeeId: String(dutyRow.employee_id || ""),
      startAt: String(dutyRow.start_at || ""),
      shiftType: String(dutyRow.shift_type || "DAY"),
      serviceName: input.service_name,
      amount,
      discount: input.discount
    });

    const svcLock = await assertNoMonthlyInvoiceLock(
      billingId,
      [row.date],
      access
    );
    if (!svcLock.success) return passFailure(svcLock);

    const inserted = await billingRepository.insertSvc(row, access);
    if (!inserted.success) return passFailure(inserted);

    // Link duty -> billing so the legacy lookup keeps working and dutyService
    // can cancel cleanly if the duty is later cancelled.
    await dutyRepository.update(
      String(dutyRow.id),
      { billing_id: billingId, updated_by: ctx.actor.email },
      access
    );

    const totals = await loadBundleWithTotals(billingId, ctx);
    if (!totals.success) {
      return failure(totals.error || "Refetch failed", totals.code, totals.details);
    }

    await recomputePaidStatus(billingId, ctx);

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: billingId,
        action: "create",
        after: inserted.data,
        stamp: `Bill from duty ${dutyRow.id}, ${dutyRow.shift_type} ₹${amount}`
      }),
      {
        billing_id: billingId,
        svc_entry: inserted.data ?? null,
        duplicate: false,
        totals: totals.data.totals
      }
    );
  },

  /**
   * Bulk-bill all uncovered duties for a patient in a YYYY-MM period.
   * Idempotent: rerunning skips already-billed duties.
   */
  async generateFromDutyRange(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<
    ApiResult<{
      billing_id: string;
      created: number;
      skipped: number;
      totals: BillingTotals;
    }>
  > {
    const parsed = parseInput(generateFromDutyRangeSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as GenerateFromDutyRangeInput;
    const access = dbAccess(ctx);

    const start = `${input.period}-01T00:00:00.000Z`;
    const [y, m] = input.period.split("-").map((n) => parseInt(n, 10));
    const next = new Date(Date.UTC(y, m, 1));
    const end = next.toISOString();

    const dutyList = await dutyRepository.list(
      {
        patientId: input.patient_id,
        from: start,
        to: end,
        limit: 500,
        offset: 0
      },
      access
    );
    if (!dutyList.success) return passFailure(dutyList);

    const ensured = await ensureActiveBilling(input.patient_id, ctx);
    if (!ensured.success) {
      return failure(ensured.error || "Could not ensure billing", ensured.code, ensured.details);
    }
    const billingRow = ensured.data;

    const editGuard = canEditBilling(String(billingRow.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Active bill is locked",
        editGuard.code,
        editGuard.details
      );
    }

    let skipped = 0;
    const billingId = String(billingRow.id);

    // P1-19: build all svc rows up-front, then hand them to
    // hominal_generate_from_duty_range so the inserts + duty.billing_id
    // flips happen in one Postgres transaction. The old per-duty JS
    // for-loop could leave a billing half-populated if any insert raised.
    const svcRows: JsonRow[] = [];
    const dutyIds: string[] = [];
    for (const duty of dutyList.data?.rows || []) {
      const status = String(duty.status || "").toUpperCase();
      if (status === "CANCELLED" || status === "NO_SHOW") {
        skipped += 1;
        continue;
      }
      const existing = await billingRepository.findSvcByDutyRemark(
        billingId,
        String(duty.id),
        access
      );
      if (!existing.success) return passFailure(existing);
      if (existing.data) {
        skipped += 1;
        continue;
      }
      const amount = amountForShift(String(duty.shift_type || "DAY"), input.rate_overrides);
      svcRows.push(
        buildServiceEntryFromDuty({
          dutyId: String(duty.id),
          patientId: String(duty.patient_id || input.patient_id),
          billingId,
          employeeId: String(duty.employee_id || ""),
          startAt: String(duty.start_at || ""),
          shiftType: String(duty.shift_type || "DAY"),
          serviceName: input.service_name,
          amount
        }) as JsonRow
      );
      dutyIds.push(String(duty.id));
    }

    let created = 0;
    if (svcRows.length > 0) {
      const rpc = await billingRepository.generateFromDutyRangeRpc(
        billingId,
        dutyIds,
        svcRows,
        ctx.actor.email || "system",
        access
      );
      if (!rpc.success) return passFailure(rpc);
      created = Number(rpc.data?.inserted || 0);
    }

    const totals = await loadBundleWithTotals(billingId, ctx);
    if (!totals.success) {
      return failure(totals.error || "Refetch failed", totals.code, totals.details);
    }

    await recomputePaidStatus(billingId, ctx);

    const resultData = {
      billing_id: billingId,
      created,
      skipped,
      totals: totals.data.totals
    };
    if (created > 0) {
      return finalizeWithAudit(
        await fireAudit(ctx, "billing", {
          entity_id: billingId,
          action: "update",
          after: totals.data.billing,
          stamp: `Generated ${created} svc entries for ${input.period} (${skipped} skipped)`
        }),
        resultData
      );
    }

    return success(resultData);
  },

  // ─────────────────────────────────────────────────────────────────────
  // Receipts
  // ─────────────────────────────────────────────────────────────────────

  async recordPayment(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<JsonRow | null>> {
    const parsed = parseInput(receiptSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as ReceiptInput;
    const access = dbAccess(ctx);

    const billing = await billingRepository.findBillingById(input.billing_id, access);
    if (!billing.success) return passFailure(billing);
    if (!billing.data) return notFoundFailure("Billing", input.billing_id);

    const editGuard = canEditBilling(String(billing.data.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Bill is closed — cannot accept new receipts",
        editGuard.code,
        editGuard.details
      );
    }

    const bundle = await loadBundleWithTotals(input.billing_id, ctx);
    if (!bundle.success) return passFailure(bundle);
    const billingOutstanding = bundle.data.totals.outstanding;
    if (Number(input.amount) > billingOutstanding + 0.005) {
      return failure(
        `Receipt amount ₹${input.amount} exceeds bill outstanding ₹${billingOutstanding}`,
        ErrorCodes.business,
        {
          outstanding: billingOutstanding,
          amount: input.amount,
          billing_id: input.billing_id
        }
      );
    }

    if (input.invoice_id) {
      const inv = await billingRepository.findInvoiceById(String(input.invoice_id), access);
      if (!inv.success) return passFailure(inv);
      if (!inv.data) return notFoundFailure("Invoice", String(input.invoice_id));
      if (String(inv.data.billing_id) !== input.billing_id) {
        return failure(
          "Invoice does not belong to this bill",
          ErrorCodes.business,
          { invoice_id: input.invoice_id, billing_id: input.billing_id }
        );
      }
      const invReceipts = await billingRepository.listReceiptsByInvoice(
        String(input.invoice_id),
        access
      );
      if (!invReceipts.success) return passFailure(invReceipts);
      const received = (invReceipts.data || []).reduce(
        (s, r) => s + Number(r.amount || 0),
        0
      );
      const outstanding = invoiceOutstanding(Number(inv.data.amount || 0), received);
      if (Number(input.amount) > outstanding + 0.005) {
        return failure(
          `Receipt amount ₹${input.amount} exceeds invoice outstanding ₹${outstanding}`,
          ErrorCodes.business,
          { outstanding, amount: input.amount, invoice_no: inv.data.invoice_no }
        );
      }
    }

    if (input.id) {
      const exists = await billingRepository.receiptExists(input.id, access);
      if (!exists.success) return passFailure(exists);
      if (exists.data) {
        return duplicateFailure("receipt_id", input.id, "Receipt id already exists");
      }
    }
    const id = input.id || newId.receipt();
    const patientId =
      (typeof input.patient_id === "string" && input.patient_id.trim()
        ? input.patient_id.trim()
        : String(billing.data.patient_id || "").trim()) || "";
    if (!patientId) {
      return failure(
        "This bill has no linked patient — cannot record a receipt until patient_id is set on the billing",
        ErrorCodes.business,
        { billing_id: input.billing_id }
      );
    }
    // P1-18: hominal_save_receipt_v2 allocates the receipt_no, writes the
    // row, links duty-days, and recomputes paid_status — all in one
    // Postgres transaction. The old multi-step flow
    // (nextReceiptNoRpc → saveReceiptRpc → stamp receipt_no →
    //  recomputePaidStatus) raced when two receipts landed in the same
    // window, occasionally leaving the bill in PARTIAL after the second
    // payment cleared it.
    const saved = await billingRepository.saveReceiptV2Rpc(
      { ...input, id, patient_id: patientId, created_by: ctx.actor.email },
      access
    );
    if (!saved.success) return passFailure(saved);
    const receiptNo: string | null =
      saved.data && typeof (saved.data as JsonRow).receipt_no === "string"
        ? String((saved.data as JsonRow).receipt_no)
        : null;

    if (input.invoice_id) {
      await recomputeInvoiceStatus(String(input.invoice_id), ctx);
    }

    // Defensive ledger sync. When Phase 16 RPC is applied on Supabase it
    // already links day-rows; this best-effort pass is idempotent (only
    // touches rows where `paid_receipt_id` is null) so it stays safe.
    await dutyDayLedger.syncReceiptCreated(
      {
        id,
        billing_id: input.billing_id,
        patient_id: patientId,
        from_date: input.from_date,
        to_date: input.to_date,
        paid_dates: input.paid_dates ?? null,
      },
      ctx.actor.email || "system",
      access
    );

    return finalizeWithAudit(
      await fireAudit(ctx, "receipt", {
        entity_id: id,
        action: "create",
        after: saved.data ?? null,
        stamp: `${receiptNo ? `${receiptNo} ` : ""}₹${input.amount} on bill ${input.billing_id}`
      }),
      saved.data ?? null
    );
  },

  /**
   * Recompute `paid_status` (UNPAID | PARTIAL | PAID) for a billing from
   * server-side totals. Idempotent — safe to call after every receipt /
   * svc-entry / soft-delete mutation. Called internally by recordPayment,
   * softDeleteReceipt, and the svc-entry replace endpoint.
   */
  async recomputePaidStatus(
    billingId: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<{ paid_status: BillingPaidStatus }>> {
    const result = await recomputePaidStatus(billingId, ctx);
    return result.success
      ? success({ paid_status: result.data })
      : failure(result.error || "Could not recompute paid status", result.code, result.details);
  },

  // ─────────────────────────────────────────────────────────────────────
  // Per-period invoices (each generation gets its own invoice_no)
  // ─────────────────────────────────────────────────────────────────────

  async listInvoices(
    billingId: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<InvoiceSummary[]>> {
    const bundle = await loadBundleWithTotals(billingId, ctx);
    if (!bundle.success) {
      return failure(bundle.error || "Bill not found", bundle.code, bundle.details);
    }
    return success(bundle.data.invoices);
  },

  async getInvoice(
    invoiceId: string,
    ctx: BillingServiceContext
  ): Promise<
    ApiResult<{
      invoice: JsonRow;
      lines: JsonRow[];
      receipts: JsonRow[];
      received: number;
      outstanding: number;
      status: BillingPaidStatus | "CANCELLED";
    }>
  > {
    const access = dbAccess(ctx);
    const invoice = await billingRepository.findInvoiceById(invoiceId, access);
    if (!invoice.success) return passFailure(invoice);
    if (!invoice.data) return notFoundFailure("Invoice", invoiceId);
    const [lines, receipts] = await Promise.all([
      billingRepository.listInvoiceLines(invoiceId, access),
      billingRepository.listReceiptsByInvoice(invoiceId, access)
    ]);
    if (!lines.success) return passFailure(lines);
    if (!receipts.success) return passFailure(receipts);
    const amount = Number(invoice.data.amount || 0);
    const received = (receipts.data || []).reduce(
      (s, r) => s + Number(r.amount || 0),
      0
    );
    const outstanding = Math.max(0, amount - received);
    let status: BillingPaidStatus | "CANCELLED";
    const persisted = String(invoice.data.status || "").toUpperCase();
    if (persisted === "CANCELLED") status = "CANCELLED";
    else if (amount <= 0 || received <= 0) status = "UNPAID";
    else if (received >= amount) status = "PAID";
    else status = "PARTIAL";
    return success({
      invoice: invoice.data,
      lines: lines.data || [],
      receipts: receipts.data || [],
      received,
      outstanding,
      status
    });
  },

  /**
   * Generate a per-period invoice. MONTHLY snapshots all svc entries in the
   * billing whose date is in `period`; MANUAL takes the explicit lines. Each
   * generation allocates a fresh invoice number and starts UNPAID.
   *
   * MONTHLY is idempotent: re-running for the same (billing_id, period)
   * returns the existing invoice with `duplicate: true`.
   */
  async generateInvoice(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<
    ApiResult<{
      invoice: JsonRow;
      lines: JsonRow[];
      duplicate: boolean;
    }>
  > {
    const parsed = parseInput(generateInvoiceSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as GenerateInvoiceInput;
    const access = dbAccess(ctx);

    const billing = await billingRepository.findBillingById(input.billing_id, access);
    if (!billing.success) return passFailure(billing);
    if (!billing.data) return notFoundFailure("Billing", input.billing_id);

    const editGuard = canEditBilling(String(billing.data.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Bill is closed — cannot issue new invoices",
        editGuard.code,
        editGuard.details
      );
    }

    // MONTHLY: idempotent.
    if (input.kind === "MONTHLY" && input.period) {
      const existing = await billingRepository.findInvoiceForPeriod(
        input.billing_id,
        input.period,
        access
      );
      if (!existing.success) return passFailure(existing);
      if (existing.data) {
        const lines = await billingRepository.listInvoiceLines(
          String(existing.data.id),
          access
        );
        return success({
          invoice: existing.data,
          lines: lines.success ? lines.data || [] : [],
          duplicate: true
        });
      }
    }

    // Build line snapshots.
    type LineSnapshot = {
      svc_entry_id: number | null;
      date: string;
      service_name: string;
      partner: string;
      count: number;
      amt: number;
      total: number;
    };
    let lines: LineSnapshot[] = [];
    let fromDate: string | null = input.from_date || null;
    let toDate: string | null = input.to_date || null;

    if (input.kind === "MONTHLY") {
      const svc = await billingRepository.listSvcByBilling(input.billing_id, access);
      if (!svc.success) return passFailure(svc);
      const period = input.period as string;
      const matching = (svc.data || []).filter(
        (s) => String(s.date || "").slice(0, 7) === period
      );
      if (matching.length === 0) {
        return failure(
          `No service entries in ${period} for this bill — nothing to invoice`,
          ErrorCodes.business
        );
      }
      lines = matching
        .map((s) => ({
          svc_entry_id:
            typeof s.id === "number" ? s.id : s.id ? Number(s.id) : null,
          date: String(s.date || ""),
          service_name: String(s.service_name || ""),
          partner: String(s.partner || ""),
          count: Number(s.count || 1),
          amt: Number(s.amt || 0),
          total: Number(s.total || 0)
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!fromDate) fromDate = lines[0].date || null;
      if (!toDate) toDate = lines[lines.length - 1].date || null;
    } else {
      lines = (input.manual_lines || []).map((l) => ({
        svc_entry_id: null,
        date: String(l.date || ""),
        service_name: String(l.service_name || ""),
        partner: String(l.partner || ""),
        count: Number(l.count || 1),
        amt: Number(l.amt || 0),
        total: Number(l.total || Number(l.amt || 0) * Number(l.count || 1))
      }));
    }

    const amount = lines.reduce((s, l) => s + Number(l.total || 0), 0);

    const invoiceNoRes = await billingRepository.nextInvoiceNoRpc(access);
    if (!invoiceNoRes.success || !invoiceNoRes.data) {
      return failure(
        invoiceNoRes.error || "Could not allocate invoice number",
        invoiceNoRes.code || ErrorCodes.internal
      );
    }
    const invoiceId = newId.invoice();
    const inserted = await billingRepository.insertInvoice(
      {
        id: invoiceId,
        invoice_no: invoiceNoRes.data,
        billing_id: input.billing_id,
        patient_id: String(billing.data.patient_id || ""),
        kind: input.kind,
        period: input.kind === "MONTHLY" ? input.period : null,
        from_date: fromDate,
        to_date: toDate,
        amount,
        status: "UNPAID",
        notes: input.notes || "",
        created_by: ctx.actor.email,
        updated_by: ctx.actor.email
      },
      access
    );
    if (!inserted.success) {
      const msg = (inserted.error || "").toLowerCase();
      if (
        input.kind === "MONTHLY" &&
        input.period &&
        (msg.includes("uq_hh_invoices_monthly_period") || msg.includes("duplicate key"))
      ) {
        const race = await billingRepository.findInvoiceForPeriod(
          input.billing_id,
          input.period,
          access
        );
        if (race.success && race.data) {
          const raceLines = await billingRepository.listInvoiceLines(
            String(race.data.id),
            access
          );
          return success({
            invoice: race.data,
            lines: raceLines.success ? raceLines.data || [] : [],
            duplicate: true
          });
        }
      }
      return passFailure(inserted);
    }
    if (!inserted.data) {
      return failure("Invoice insert returned no row", ErrorCodes.internal);
    }

    if (lines.length) {
      const linesRes = await billingRepository.insertInvoiceLines(
        lines.map((l) => ({ ...l, invoice_id: invoiceId })),
        access
      );
      if (!linesRes.success) return passFailure(linesRes);
    }

    const linesAfter = await billingRepository.listInvoiceLines(invoiceId, access);

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: invoiceId,
        action: "create",
        after: inserted.data,
        stamp: `${invoiceNoRes.data} ${input.kind}${
          input.kind === "MONTHLY" ? ` ${input.period}` : ""
        } ₹${amount}`
      }),
      {
        invoice: inserted.data,
        lines: linesAfter.success ? linesAfter.data || [] : [],
        duplicate: false
      }
    );
  },

  /**
   * Generate a FINAL closing invoice for a billing. Atomic Postgres RPC:
   *   1. Snapshots all unbilled svc entries (invoice amount = gross).
   *   2. Creates a `type='Security'` receipt for min(sec_dep, gross) linked
   *      to the FINAL invoice so billing outstanding drops for close.
   *   3. If sec_dep > gross, auto-creates a Refund receipt for the excess.
   *   4. Zeroes hh_billings.sec_dep.
   * Also invoked automatically from `close()` and `hominal_close_patient`.
   */
  async generateFinalInvoice(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<
    ApiResult<{
      invoice: JsonRow;
      lines: JsonRow[];
      duplicate: boolean;
      security_receipt_id: string | null;
      refund_id: string | null;
      refund_amount: number;
      sec_dep_applied: number;
      gross: number;
      net: number;
    }>
  > {
    const parsed = parseInput(finalInvoiceSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as FinalInvoiceInput;
    const access = dbAccess(ctx);

    const billing = await billingRepository.findBillingById(input.billing_id, access);
    if (!billing.success) return passFailure(billing);
    if (!billing.data) return notFoundFailure("Billing", input.billing_id);

    // Cancelled bills can never get a FINAL. Closed bills CAN — that
    // is the recovery path for bills closed before the FINAL flow
    // shipped. The unique-final-per-billing partial index keeps it
    // idempotent and the RPC re-checks the Cancelled status.
    const billingStatus = String(billing.data.status || "");
    if (billingStatus === "Cancelled") {
      return failure(
        "Bill is Cancelled — cannot issue a FINAL invoice",
        ErrorCodes.business
      );
    }

    const rpc = await billingRepository.generateFinalInvoiceRpc(
      input.billing_id,
      ctx.actor.email || "system",
      input.notes || "",
      access
    );
    if (!rpc.success) return passFailure(rpc);
    if (!rpc.data || !rpc.data.invoice_id) {
      return failure("FINAL invoice generation returned no row", ErrorCodes.internal);
    }

    const invoiceId = String(rpc.data.invoice_id);
    const [invoiceRes, linesRes] = await Promise.all([
      billingRepository.findInvoiceById(invoiceId, access),
      billingRepository.listInvoiceLines(invoiceId, access)
    ]);
    if (!invoiceRes.success) return passFailure(invoiceRes);
    if (!invoiceRes.data) return notFoundFailure("Invoice", invoiceId);

    const lines = linesRes.success ? linesRes.data || [] : [];

    const payload = {
      invoice: invoiceRes.data,
      lines,
      duplicate: !!rpc.data.duplicate,
      security_receipt_id: rpc.data.security_receipt_id || null,
      refund_id: rpc.data.refund_id || null,
      refund_amount: Number(rpc.data.refund_amount || 0),
      sec_dep_applied: Number(rpc.data.sec_dep_applied || 0),
      gross: Number(rpc.data.gross || 0),
      net: Number(rpc.data.net || 0)
    };

    if (rpc.data.duplicate) {
      return success(payload);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: invoiceId,
        action: "create",
        after: invoiceRes.data,
        stamp: `FINAL ${invoiceRes.data.invoice_no || invoiceId}` +
          ` gross ₹${rpc.data.gross}` +
          ` deposit ₹${rpc.data.sec_dep_applied}` +
          ` net ₹${rpc.data.net}` +
          (rpc.data.refund_amount > 0 ? ` refund ₹${rpc.data.refund_amount}` : "")
      }),
      payload
    );
  },

  /**
   * Rebuild a MONTHLY invoice snapshot from live svc entries (only when no
   * receipts have been applied).
   */
  async regenerateInvoice(
    invoiceId: string,
    ctx: BillingServiceContext
  ): Promise<
    ApiResult<{
      invoice: JsonRow;
      lines: JsonRow[];
    }>
  > {
    const access = dbAccess(ctx);
    const existing = await billingRepository.findInvoiceById(invoiceId, access);
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Invoice", invoiceId);

    if (String(existing.data.kind || "") !== "MONTHLY" || !existing.data.period) {
      return failure(
        "Only MONTHLY invoices can be regenerated from service entries",
        ErrorCodes.business
      );
    }

    const billingId = String(existing.data.billing_id || "");
    const billing = await billingRepository.findBillingById(billingId, access);
    if (!billing.success) return passFailure(billing);
    if (!billing.data) return notFoundFailure("Billing", billingId);

    const editGuard = canEditBilling(String(billing.data.status || ""));
    if (!editGuard.success) {
      return failure(editGuard.error || "Bill is locked", editGuard.code, editGuard.details);
    }

    const receipts = await billingRepository.listReceiptsByInvoice(invoiceId, access);
    if (!receipts.success) return passFailure(receipts);
    const received = (receipts.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    if (received > 0) {
      return failure(
        "Cannot regenerate an invoice that already has receipts — delete receipts first",
        ErrorCodes.business,
        { received }
      );
    }

    const period = String(existing.data.period);
    const svc = await billingRepository.listSvcByBilling(billingId, access);
    if (!svc.success) return passFailure(svc);
    const matching = (svc.data || []).filter(
      (s) => String(s.date || "").slice(0, 7) === period
    );
    if (!matching.length) {
      return failure(
        `No service entries in ${period} — nothing to regenerate`,
        ErrorCodes.business
      );
    }

    const lines = matching
      .map((s) => ({
        svc_entry_id: typeof s.id === "number" ? s.id : s.id ? Number(s.id) : null,
        date: String(s.date || ""),
        service_name: String(s.service_name || ""),
        partner: String(s.partner || ""),
        count: Number(s.count || 1),
        amt: Number(s.amt || 0),
        total: Number(s.total || 0),
        invoice_id: invoiceId
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const amount = lines.reduce((s, l) => s + Number(l.total || 0), 0);
    const fromDate = lines[0]?.date || null;
    const toDate = lines[lines.length - 1]?.date || null;

    const cleared = await billingRepository.removeInvoiceLinesByInvoice(invoiceId, access);
    if (!cleared.success) return passFailure(cleared);

    if (lines.length) {
      const inserted = await billingRepository.insertInvoiceLines(lines, access);
      if (!inserted.success) return passFailure(inserted);
    }

    const updated = await billingRepository.updateInvoice(
      invoiceId,
      {
        amount,
        from_date: fromDate,
        to_date: toDate,
        status: "UNPAID",
        updated_by: ctx.actor.email
      },
      access
    );
    if (!updated.success) return passFailure(updated);
    if (!updated.data) {
      return failure("Invoice update returned no row", ErrorCodes.internal);
    }

    const linesAfter = await billingRepository.listInvoiceLines(invoiceId, access);

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: invoiceId,
        action: "update",
        before: existing.data,
        after: updated.data,
        stamp: `Regenerated ${existing.data.invoice_no} for ${period} ₹${amount}`
      }),
      {
        invoice: updated.data,
        lines: linesAfter.success ? linesAfter.data || [] : []
      }
    );
  },

  async recomputeInvoiceStatus(
    invoiceId: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<{ status: BillingPaidStatus | "CANCELLED" }>> {
    const res = await recomputeInvoiceStatus(invoiceId, ctx);
    return res.success
      ? success({ status: res.data })
      : failure(res.error || "Could not recompute invoice status", res.code, res.details);
  },

  /**
   * Cancel an invoice = HARD DELETE. The invoice + its lines are removed from
   * the system; any receipts that were applied to it are detached
   * (invoice_id → NULL) so they stay on the bill as on-account credit.
   * After deletion the invoice number sequence is compacted so the next
   * generation continues without a gap.
   */
  async cancelInvoice(
    invoiceId: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<{ deleted: true; invoice_no: string; receipts_detached: number }>> {
    const access = dbAccess(ctx);
    const existing = await billingRepository.findInvoiceById(invoiceId, access);
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Invoice", invoiceId);

    const rpc = await billingRepository.deleteInvoiceRpc(
      invoiceId,
      ctx.actor.email || "",
      access
    );
    if (!rpc.success) return passFailure(rpc);
    const payload = rpc.data;
    if (!payload?.ok) {
      return failure(
        payload?.message || "Could not delete invoice",
        payload?.code === "BUSINESS" ? ErrorCodes.business : ErrorCodes.internal,
        payload ?? undefined
      );
    }

    const billingId = String(payload.billing_id || existing.data.billing_id || "");
    if (billingId) {
      const paid = await recomputePaidStatus(billingId, ctx);
      if (!paid.success) return passFailure(paid);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: invoiceId,
        action: "soft-delete",
        before: existing.data,
        after: null,
        stamp: `Invoice ${payload.invoice_no || invoiceId} deleted (${payload.receipts_detached ?? 0} receipts detached)`
      }),
      {
        deleted: true as const,
        invoice_no: String(payload.invoice_no || existing.data.invoice_no || invoiceId),
        receipts_detached: Number(payload.receipts_detached ?? 0)
      }
    );
  },

  /** List ACTIVE (not soft-deleted) receipts for a billing. */
  async listReceiptsForBilling(
    billingId: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<JsonRow[]>> {
    const access = dbAccess(ctx);
    const billing = await billingRepository.findBillingById(billingId, access);
    if (!billing.success) return passFailure(billing);
    if (!billing.data) return notFoundFailure("Billing", billingId);
    const rows = await billingRepository.listActiveReceiptsByBilling(billingId, access);
    if (!rows.success) return passFailure(rows);
    return success(rows.data || []);
  },

  /**
   * Soft-delete a receipt via the audited RPC. Refuses if the parent bill is
   * closed/cancelled; honours `canEditBilling`.
   */
  async softDeleteReceipt(
    billingId: string,
    receiptId: string,
    ctx: BillingServiceContext,
    reason?: string
  ): Promise<ApiResult<JsonRow | null>> {
    if (!receiptId) {
      return failure("Receipt id is required", ErrorCodes.validation);
    }
    const access = dbAccess(ctx);

    const billing = await billingRepository.findBillingById(billingId, access);
    if (!billing.success) return passFailure(billing);
    if (!billing.data) return notFoundFailure("Billing", billingId);

    const editGuard = canEditBilling(String(billing.data.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Bill is closed — cannot delete receipts",
        editGuard.code,
        editGuard.details
      );
    }

    const existing = await billingRepository.findReceiptById(receiptId, access);
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Receipt", receiptId);

    const deleted = await billingRepository.softDeleteReceiptRpc(
      receiptId,
      billingId,
      ctx.actor.email || "",
      access
    );
    if (!deleted.success) return passFailure(deleted);

    await recomputePaidStatus(billingId, ctx);
    const linkedInvoiceId = String((existing.data || {}).invoice_id || "");
    if (linkedInvoiceId) {
      await recomputeInvoiceStatus(linkedInvoiceId, ctx);
    }

    // Defensive ledger release. Idempotent: only clears rows that still
    // point at this receipt id, so it's safe alongside the Phase 16 RPC.
    await dutyDayLedger.syncReceiptDeleted(
      receiptId,
      ctx.actor.email || "system",
      access
    );

    return finalizeWithAudit(
      await fireAudit(ctx, "receipt", {
        entity_id: receiptId,
        action: "soft-delete",
        before: existing.data,
        after: deleted.data ?? null,
        stamp: reason ? `Deleted: ${reason}` : `Receipt ${receiptId} deleted`
      }),
      deleted.data ?? null
    );
  },

  /**
   * Legacy SPA upsert — mirrors `sbUpsert('hh_billings', [toSbBilling(...)])`.
   *
   * - Inserts when the row id is new (honours client-generated `INVE…` ids).
   * - Updates sec_dep / status / close_reason / pause_reason on existing rows.
   * - Refuses illegal status transitions and edits on Cancelled bills.
   */
  async syncLegacy(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(billingLegacySyncSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as BillingLegacySyncInput;
    const access = dbAccess(ctx);

    let existing: JsonRow | null = null;
    if (input.id) {
      const byId = await billingRepository.findBillingById(input.id, access);
      if (!byId.success) return passFailure(byId);
      existing = byId.data ?? null;
    }
    if (!existing) {
      const active = await billingRepository.findActiveByPatient(input.patient_id, access);
      if (!active.success) return passFailure(active);
      existing = active.data ?? null;
    }

    if (!existing) {
      const insertId = input.id || newId.billing();
      const inserted = await billingRepository.insertBilling(
        {
          id: insertId,
          patient_id: input.patient_id,
          status: input.status || "Active",
          sec_dep: input.sec_dep ?? 0,
          created: new Date().toISOString()
        },
        access
      );
      if (!inserted.success) {
        const msg = (inserted.error || "").toLowerCase();
        if (
          msg.includes("uq_hh_billings_patient_active") ||
          msg.includes("duplicate key value")
        ) {
          const retry = await billingRepository.findActiveByPatient(input.patient_id, access);
          if (retry.success && retry.data) return success(retry.data);
        }
        return passFailure(inserted);
      }
      if (!inserted.data) {
        return failure("Billing insert returned no row", ErrorCodes.internal);
      }
      return finalizeWithAudit(
        await fireAudit(ctx, "billing", {
          entity_id: String(inserted.data.id),
          action: "create",
          after: inserted.data,
          stamp: `Legacy sync created bill for ${input.patient_id}`
        }),
        inserted.data
      );
    }

    const currentStatus = String(existing.status || "Active");
    if (currentStatus === "Cancelled") {
      return failure("Cancelled bills cannot be updated", ErrorCodes.business);
    }

    const nextStatus = (input.status || currentStatus) as BillingStatus;
    if (nextStatus !== currentStatus) {
      const transition = canTransitionTo(currentStatus, nextStatus);
      if (!transition.success) {
        return failure(
          transition.error || "Illegal status transition",
          transition.code,
          transition.details
        );
      }
    }

    const patch: JsonRow = {};
    if (input.sec_dep !== undefined) patch.sec_dep = input.sec_dep;
    if (nextStatus !== currentStatus) {
      if (nextStatus === "Paused") {
        Object.assign(patch, billingPauseRow(ctx.actor.email, input.pause_reason));
      } else if (nextStatus === "Closed") {
        Object.assign(
          patch,
          billingCloseRow(ctx.actor.email, input.close_reason, input.close_reason_other)
        );
      } else {
        Object.assign(patch, billingStatusRow(nextStatus, ctx.actor.email));
      }
    }

    if (Object.keys(patch).length === 0) {
      return success(existing);
    }

    const editGuard =
      nextStatus === "Closed" || nextStatus === "Cancelled"
        ? { success: true as const }
        : canEditBilling(currentStatus);
    if (!editGuard.success && input.sec_dep === undefined) {
      return failure(editGuard.error || "Bill locked", editGuard.code, editGuard.details);
    }
    if (!editGuard.success && input.sec_dep !== undefined) {
      const secOnly: JsonRow = {
        sec_dep: input.sec_dep,
        updated_by: ctx.actor.email
      };
      const secUpdated = await billingRepository.updateBilling(
        String(existing.id),
        secOnly,
        access
      );
      if (!secUpdated.success) return passFailure(secUpdated);
      const freshSec = await loadFreshBilling(String(existing.id), ctx, secUpdated.data ?? null);
      if (!freshSec.success) {
        return failure(freshSec.error || "Refetch failed", freshSec.code, freshSec.details);
      }
      return success(freshSec.data);
    }

    const updated = await billingRepository.updateBilling(String(existing.id), patch, access);
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshBilling(String(existing.id), ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: String(existing.id),
        action: "update",
        before: existing,
        after: fresh.data,
        stamp: `Legacy sync (${nextStatus})`
      }),
      fresh.data
    );
  },

  /**
   * Replace the entire `hh_svc_entries` slice for a `svc_key` (duty diary
   * save). Refuses when the parent billing is Closed/Cancelled.
   *
   * `svc_key` format used by the legacy SPA: `<billingId>_<serviceName>`.
   */
  async replaceServiceEntries(
    rawInput: unknown,
    ctx: BillingServiceContext
  ): Promise<ApiResult<{ svc_key: string; count: number }>> {
    const parsed = parseInput(replaceServiceEntriesSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as ReplaceServiceEntriesInput;
    const access = dbAccess(ctx);

    const billingId = String(input.svc_key).split("_")[0];
    if (!billingId) {
      return failure("svc_key is missing billing id prefix", ErrorCodes.validation);
    }

    const billing = await billingRepository.findBillingById(billingId, access);
    if (!billing.success) return passFailure(billing);
    if (!billing.data) return notFoundFailure("Billing", billingId);

    const editGuard = canEditBilling(String(billing.data.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Bill is locked — cannot edit service entries",
        editGuard.code,
        editGuard.details
      );
    }

    const lock = await assertNoMonthlyInvoiceLock(
      billingId,
      input.rows.map((r) => r.date || ""),
      access
    );
    if (!lock.success) return passFailure(lock);

    const rows: JsonRow[] = input.rows.map((row) => ({
      billing_id: row.billing_id || billingId,
      service_name: row.service_name || "",
      partner: row.partner || "",
      partner_id: row.partner_id || "",
      date: row.date || "",
      freq: row.freq || "",
      amt: row.amt,
      count: row.count,
      disc: row.disc,
      total: row.total,
      remarks: row.remarks || ""
    }));

    const replaced = await billingRepository.replaceSvcEntriesRpc(
      input.svc_key,
      rows,
      access
    );
    if (!replaced.success) return passFailure(replaced);

    // Phase 11 — best-effort duty-day ledger sync after the legacy RPC
    // physically rewrites the svc_entries slice. We:
    //   1. Re-read the fresh svc rows for this (billing, service_name) slice.
    //   2. Upsert per-day ledger rows for each fresh entry.
    //   3. Soft-delete any orphan day-rows whose svc_entry_id is no longer
    //      present (the RPC deletes + reinserts, so ids change).
    try {
      const serviceName = rows[0]?.service_name
        ? String(rows[0].service_name)
        : input.svc_key.includes("_")
          ? input.svc_key.slice(input.svc_key.indexOf("_") + 1)
          : "";
      const fresh = await billingRepository.listSvcByBilling(billingId, access);
      const freshRows = fresh.success
        ? (fresh.data || []).filter(
            (r) =>
              !serviceName ||
              String(r.service_name || "") === serviceName
          )
        : [];
      for (const row of freshRows) {
        await dutyDayLedger.syncSvcEntryUpsert(
          {
            id: String(row.id || ""),
            svc_key: String(row.svc_key || input.svc_key),
            billing_id: String(row.billing_id || billingId),
            service_name: String(row.service_name || serviceName),
            partner_id: String(row.partner_id || ""),
            date: String(row.date || ""),
            count: row.count as number | string | null,
            amt: row.amt as number | string | null
          },
          ctx.actor.email,
          access
        );
      }
      const keepIds = freshRows.map((r) => String(r.id || "")).filter(Boolean);
      await dutyDayLedger.syncSvcKeyReplace(
        billingId,
        serviceName,
        keepIds,
        ctx.actor.email,
        access
      );
    } catch (err) {
      console.error("[dutyDayLedger] svc-entry replace sync failed", err);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "svc_entry", {
        entity_id: input.svc_key,
        action: "update",
        after: { svc_key: input.svc_key, count: rows.length },
        stamp: `Replaced ${rows.length} service entries for ${input.svc_key}`
      }),
      { svc_key: input.svc_key, count: rows.length }
    );
  },

  // ─────────────────────────────────────────────────────────────────────
  // Report parity
  // ─────────────────────────────────────────────────────────────────────

  async monthlyServiceTotal(
    period: string,
    ctx: BillingServiceContext
  ): Promise<ApiResult<{ period: string; total: number; rowCount: number }>> {
    const result = await billingRepository.sumServiceTotalsForPeriod(period, dbAccess(ctx));
    if (!result.success) return passFailure(result);
    const data = result.data;
    return success({
      period,
      total: data?.total ?? 0,
      rowCount: (data?.rows || []).length
    });
  },

  /** Convenience helper used by tests + UI — same totals the bill itself reports. */
  computeTotals(billing: JsonRow, services: JsonRow[], receipts: JsonRow[]): BillingTotals {
    return computeBillingTotals({
      services,
      receipts,
      secDep: Number(billing.sec_dep || 0)
    });
  }
};

export type { BillingTotals };

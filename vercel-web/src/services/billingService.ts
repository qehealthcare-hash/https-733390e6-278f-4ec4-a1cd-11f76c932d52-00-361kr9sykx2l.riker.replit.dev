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
import { newId } from "@/business/idRules";
import { billingRepository } from "@/database/billingRepository";
import { patientRepository } from "@/database/patientRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
import type { JsonRow } from "@/database/types";
import {
  duplicateFailure,
  failure,
  notFoundFailure,
  passFailure,
  success
} from "@/utils/apiResponse";

export interface ActorLike {
  email: string;
  role?: string;
  accessToken?: string;
}

export interface BillingServiceContext {
  actor: ActorLike;
  accessToken?: string;
}

function dbAccess(ctx: BillingServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
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

export interface BillingWithTotals {
  billing: JsonRow;
  services: JsonRow[];
  receipts: JsonRow[];
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

  return {
    success: true,
    data: {
      billing,
      services,
      receipts,
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

    const result = await billingRepository.listBillings(
      {
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        patient_id: query.patient_id,
        status: query.status
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);
    return success({
      rows: result.data?.rows || [],
      total: result.data?.total ?? 0
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
    const billingIds = new Set(billingRows.map((b) => String(b.id)));

    const [allReceipts, allSvc] = await Promise.all([
      billingRepository.listAllReceipts(access),
      // Pull svc entries via per-billing reads (cheap on indexed billing_id):
      Promise.all(
        billingRows.map((b) =>
          billingRepository.listSvcByBilling(String(b.id), access)
        )
      )
    ]);
    if (!allReceipts.success) return passFailure(allReceipts);
    for (const r of allSvc) {
      if (!r.success) return passFailure(r);
    }

    const receipts = (allReceipts.data || []).filter((r) =>
      billingIds.has(String(r.billing_id || ""))
    );
    const services: JsonRow[] = [];
    for (const r of allSvc) services.push(...(r.data || []));

    const totalsByBilling: Record<string, BillingTotals> = {};
    for (const b of billingRows) {
      const id = String(b.id);
      totalsByBilling[id] = computeBillingTotals({
        services: services.filter((s) => String(s.billing_id) === id),
        receipts: receipts.filter((r) => String(r.billing_id) === id),
        secDep: Number(b.sec_dep || 0)
      });
    }

    return success({
      billings: billingRows,
      receipts,
      services,
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

    const patch = billingCloseRow(ctx.actor.email, input.reason, input.close_reason_other);
    const updated = await billingRepository.updateBilling(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const refreshed = await loadBundleWithTotals(id, ctx);
    if (!refreshed.success) {
      return failure(refreshed.error || "Refetch failed", refreshed.code, refreshed.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: id,
        action: "close",
        before: existing.data,
        after: refreshed.data.billing,
        stamp: `Closed${input.reason ? `: ${input.reason}` : ""}${input.force ? " (force)" : ""}`
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

    const patch = billingReopenRow(ctx.actor.email, input.reason);
    const updated = await billingRepository.updateBilling(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const refreshed = await loadBundleWithTotals(id, ctx);
    if (!refreshed.success) {
      return failure(refreshed.error || "Refetch failed", refreshed.code, refreshed.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, "billing", {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: refreshed.data.billing,
        stamp: `Reopened: ${input.reason}`
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

    let created = 0;
    let skipped = 0;
    const billingId = String(billingRow.id);

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
      const row = buildServiceEntryFromDuty({
        dutyId: String(duty.id),
        patientId: String(duty.patient_id || input.patient_id),
        billingId,
        employeeId: String(duty.employee_id || ""),
        startAt: String(duty.start_at || ""),
        shiftType: String(duty.shift_type || "DAY"),
        serviceName: input.service_name,
        amount
      });
      const inserted = await billingRepository.insertSvc(row, access);
      if (!inserted.success) return passFailure(inserted);
      await dutyRepository.update(
        String(duty.id),
        { billing_id: billingId, updated_by: ctx.actor.email },
        access
      );
      created += 1;
    }

    const totals = await loadBundleWithTotals(billingId, ctx);
    if (!totals.success) {
      return failure(totals.error || "Refetch failed", totals.code, totals.details);
    }

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

    if (input.id) {
      const exists = await billingRepository.receiptExists(input.id, access);
      if (!exists.success) return passFailure(exists);
      if (exists.data) {
        return duplicateFailure("receipt_id", input.id, "Receipt id already exists");
      }
    }
    const id = input.id || newId.receipt();
    const saved = await billingRepository.saveReceiptRpc(
      { ...input, id, created_by: ctx.actor.email },
      access
    );
    if (!saved.success) return passFailure(saved);

    return finalizeWithAudit(
      await fireAudit(ctx, "receipt", {
        entity_id: id,
        action: "create",
        after: saved.data ?? null,
        stamp: `₹${input.amount} on bill ${input.billing_id}`
      }),
      saved.data ?? null
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
          created: input.created || new Date().toISOString()
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

/**
 * Duty service — corporate-grade layered facade for the CRM's duty calendar.
 *
 * Composes /src/validation/dutyValidation + /src/business/dutyRules +
 * /src/database/dutyRepository + /src/database/auditRepository.
 *
 * Hardened rules (Phase 7c):
 *   - shift / status / dates validated by Zod (cross-field guards inline).
 *   - Overlap is blocked for BOTH the same employee AND the same patient.
 *   - COMPLETED duties may not be edited back to a non-COMPLETED status.
 *   - Cancelling a duty rolls back the service-entry row it created in
 *     `hh_svc_entries`, UNLESS receipts have already been recorded against
 *     the parent billing (would corrupt finance — fail loudly instead).
 *   - check-in upserts attendance; check-out closes attendance + recomputes
 *     payouts for the duty's own YYYY-MM (M3 rule).
 *   - Every mutation refetches the persisted row, then writes an audit log.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import {
  dutySchema,
  dutyCancelSchema,
  dutyCheckAtSchema,
  dutyListQuerySchema,
  dutyMaterializeSchema,
  dutyPartnersSchema,
  type DutyInput,
  type DutyCancelInput,
  type DutyCheckAtInput,
  type DutyListQuery,
  type DutyMaterializeInput,
  type DutyPartnersInput,
  type DutyStatus,
  type DutyShiftType
} from "@/validation/dutyValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  buildDutyPermissions,
  computeDutyFreeze,
  canCancelDutyWithBilling,
  canCancelDuty,
  canDeleteDuty,
  canEditDutyStatus,
  canReopenCompletedDuty,
  dutyCancellationPatch,
  dutyDeletionPatch,
  dutyCheckInPatch,
  dutyCheckOutPatch,
  dutyPersistRow,
  isOpenEndedEndAt,
  OPEN_ENDED_END_AT,
  payoutPeriodForDuty,
  selectOverlappingDuty,
  selectPatientOverlappingDuty,
  selectSamePatientEmployeeOverlap,
  shouldCheckDutyOverlap,
  type DutyTimeSlot
} from "@/business/dutyRules";
import { assertNotStale, requireExpectedVersion } from "@/business/concurrencyRules";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { hoursBetween } from "@/business/attendanceRules";
import { newId } from "@/business/idRules";
import { dutyRepository } from "@/database/dutyRepository";
import { attendanceRepository } from "@/database/attendanceRepository";
import {
  syncDutyCheckIn,
  syncDutyCheckOut,
  syncDutyCancelledAbsent
} from "@/services/attendanceDutySync";
import { recomputePayoutIfEditable } from "@/services/recomputePayoutIfEditable";
import { payoutRepository } from "@/database/payoutRepository";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
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

export interface DutyServiceContext {
  actor: ServiceActor;
  /** Optional override; defaults to actor.accessToken. */
  accessToken?: string;
}

function dbAccess(ctx: DutyServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function fireAudit(
  ctx: DutyServiceContext,
  payload: {
    entity_id: string;
    action: "create" | "update" | "delete";
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module: "duty",
    entity_id: payload.entity_id,
    action: payload.action,
    stamp: payload.stamp,
    before: payload.before ?? null,
    after: payload.after ?? null
  });
}

/**
 * Discriminated union variant of ApiResult so the success branch narrows
 * `data` to `T` (not `T | undefined`) after a `success` check.
 */
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

interface ExtendSummary {
  processed: number;
  created_svc: number;
  created_payout: number;
  updated_svc: number;
  updated_payout: number;
  deleted_svc: number;
  deleted_payout: number;
  skipped: number;
  skipped_no_bill: number;
  errors: { duty_id: string; error: string }[];
}

/**
 * Shared materialize loop for both `extendActive` (global cron sweep) and
 * `extendForPatient` (explicit patient-scoped backfill from billingService.syncDutyLedgerForPatient).
 * Iterates every duty returned by `loader`, skips ones whose
 * patient has no Active bill, and lets per-duty errors flow through to
 * `errors[]` without aborting the whole pass.
 *
 * Pass `{ audit: true }` to write the global cron-extend audit row at the
 * end. The patient-scoped lazy path passes `{ audit: false }` to avoid
 * flooding the audit log on every billing read.
 */
async function runExtendOverDuties(
  loader: () => Promise<ApiResult<JsonRow[]>>,
  ctx: DutyServiceContext,
  opts: { audit: boolean; from?: string; to?: string; prune?: boolean }
): Promise<ApiResult<ExtendSummary>> {
  const active = await loader();
  if (!active.success) return passFailure(active);

  let createdSvc = 0;
  let createdPayout = 0;
  let updatedSvc = 0;
  let updatedPayout = 0;
  let deletedSvc = 0;
  let deletedPayout = 0;
  let skipped = 0;
  let skippedNoBill = 0;
  const errors: { duty_id: string; error: string }[] = [];

  const { billingRepository } = await import("@/database/billingRepository");
  const access = dbAccess(ctx);

  for (const duty of active.data || []) {
    const id = String(duty.id);
    // Skip duties whose patient has no Active bill — materializeDuty would
    // fail with "No active bill for patient" and that's expected (operator
    // hasn't opened a bill yet, or the bill is already Closed). This keeps
    // the cron summary honest and avoids noisy error counts.
    const patientId = String(duty.patient_id || "");
    if (!patientId) {
      skippedNoBill += 1;
      continue;
    }
    const bill = await billingRepository.findActiveByPatient(patientId, access);
    if (!bill.success) {
      errors.push({ duty_id: id, error: bill.error || bill.code || "active-bill lookup failed" });
      continue;
    }
    if (!bill.data) {
      skippedNoBill += 1;
      continue;
    }

    const mat = await dutyDiaryService.materializeDuty(duty, ctx, {
      from: opts.from,
      to: opts.to,
      prune: opts.prune
    });
    if (!mat.success) {
      errors.push({ duty_id: id, error: mat.error || mat.code || "materialize failed" });
      continue;
    }
    const r = mat.data!;
    createdSvc += r.created_svc;
    createdPayout += r.created_payout;
    updatedSvc += r.updated_svc;
    updatedPayout += r.updated_payout;
    deletedSvc += r.deleted_svc;
    deletedPayout += r.deleted_payout;
    skipped += r.skipped;
  }

  const summary: ExtendSummary = {
    processed: active.data?.length || 0,
    created_svc: createdSvc,
    created_payout: createdPayout,
    updated_svc: updatedSvc,
    updated_payout: updatedPayout,
    deleted_svc: deletedSvc,
    deleted_payout: deletedPayout,
    skipped,
    skipped_no_bill: skippedNoBill,
    errors
  };

  if (opts.audit) {
    // Best-effort audit for the cron run itself. Skipped when nothing
    // mutated to avoid log noise on idle nights.
    const mutated =
      createdSvc + updatedSvc + deletedSvc + createdPayout + updatedPayout + deletedPayout;
    if (mutated > 0 || errors.length > 0) {
      try {
        await writeMutationAudit(dbAccess(ctx), ctx.actor, {
          module: "duty_cron",
          entity_id: "duties-extend",
          action: "update",
          stamp:
            `Cron extend · processed:${summary.processed}` +
            ` skipped-no-bill:${skippedNoBill}` +
            ` created:${createdSvc}/${createdPayout}` +
            ` updated:${updatedSvc}/${updatedPayout}` +
            ` deleted:${deletedSvc}/${deletedPayout}` +
            (errors.length ? ` errors:${errors.length}` : ""),
          before: null,
          after: summary
        });
      } catch (err) {
        console.error("[dutyService.extendActive] cron audit write failed", err);
      }
    }
  }

  return success(summary);
}

async function loadDuty(
  id: string,
  ctx: DutyServiceContext
): Promise<LoadResult<JsonRow>> {
  const row = await dutyRepository.findById(id, dbAccess(ctx));
  if (!row.success) return toLoadFailure(row);
  if (!row.data) return toLoadFailure(notFoundFailure("Duty", id));
  return { success: true, data: row.data };
}

async function loadFreshDuty(
  id: string,
  ctx: DutyServiceContext,
  fallback?: JsonRow | null
): Promise<LoadResult<JsonRow>> {
  const refreshed = await dutyRepository.findById(id, dbAccess(ctx));
  if (!refreshed.success) return toLoadFailure(refreshed);
  const row = refreshed.data ?? fallback ?? null;
  if (!row) return toLoadFailure(failure("Duty not found after mutation", ErrorCodes.internal));
  return { success: true, data: row };
}

function asSlot(row: JsonRow): DutyTimeSlot {
  return {
    id: String(row.id),
    employee_id: (row.employee_id as string | undefined) ?? null,
    patient_id: (row.patient_id as string | undefined) ?? null,
    start_at: String(row.start_at ?? ""),
    end_at: String(row.end_at ?? ""),
    status: (row.status as string | undefined) ?? null
  };
}

async function ensureNoOverlap(
  input: {
    employee_id: string;
    patient_id: string;
    start_at: string;
    end_at?: string;
    status: DutyStatus;
    confirm_staff_overlap?: boolean;
    confirm_patient_overlap?: boolean;
  },
  excludeId: string | undefined,
  ctx: DutyServiceContext
): Promise<ApiResult<null>> {
  if (!shouldCheckDutyOverlap(input.status)) return success(null);
  const access = dbAccess(ctx);

  // For overlap checks an open-ended duty (no end_at) is treated as a
  // 24h window starting at start_at. This avoids false positives where
  // two open-ended duties on different patients would otherwise both
  // appear to span until 2099, while still catching same-day collisions.
  const effectiveEnd =
    input.end_at && input.end_at.trim()
      ? input.end_at
      : new Date(new Date(input.start_at).getTime() + 24 * 3600 * 1000).toISOString();

  // HARD guard (non-bypassable): the SAME carer can never hold two overlapping
  // active duties for the SAME patient. Relief / partner-share always uses a
  // different employee, so this never blocks a legitimate booking. Open-ended
  // duties use the far-future sentinel here (NOT the 24h window) so two
  // open-ended duties for the same pair always collide — closing the exact
  // hole that silently doubled billing + payout. No confirm flag overrides it.
  const hardEnd =
    input.end_at && input.end_at.trim() && !isOpenEndedEndAt(input.end_at)
      ? input.end_at
      : OPEN_ENDED_END_AT;
  const samePairRows = await dutyRepository.findOverlappingForPatient(
    input.patient_id,
    input.start_at,
    hardEnd,
    excludeId,
    access
  );
  if (!samePairRows.success) return passFailure<null>(samePairRows);
  const samePairConflict = selectSamePatientEmployeeOverlap(
    (samePairRows.data || []).map(asSlot),
    input.patient_id,
    input.employee_id,
    input.start_at,
    hardEnd,
    excludeId
  );
  if (samePairConflict) {
    return duplicateFailure(
      "patient_employee_window",
      samePairConflict.id,
      "This carer already has an overlapping duty for this patient. Close or " +
        "cancel the existing duty first — the same carer cannot be booked twice " +
        "for the same patient (it would double billing and payout)."
    );
  }

  if (!input.confirm_staff_overlap) {
    const empRows = await dutyRepository.findOverlapping(
      input.employee_id,
      input.start_at,
      effectiveEnd,
      excludeId,
      access
    );
    if (!empRows.success) return passFailure<null>(empRows);
    const empConflict = selectOverlappingDuty(
      (empRows.data || []).map(asSlot),
      input.employee_id,
      input.start_at,
      effectiveEnd,
      excludeId
    );
    if (empConflict) {
      return duplicateFailure(
        "employee_window",
        empConflict.id,
        "Staff already has a duty overlapping this time. Confirm to assign anyway (relief / partner share)."
      );
    }
  }

  // Patient-side overlap: legitimate when two carers cover one patient (partner
  // share / relief), but accidentally booking two open-ended duties for the
  // same patient silently doubled the diary charges before today. We surface
  // it as a confirmable warning so operators must opt in.
  if (!input.confirm_patient_overlap) {
    const patRows = await dutyRepository.findOverlappingForPatient(
      input.patient_id,
      input.start_at,
      effectiveEnd,
      excludeId,
      access
    );
    if (!patRows.success) return passFailure<null>(patRows);
    const patConflict = selectPatientOverlappingDuty(
      (patRows.data || []).map(asSlot),
      input.patient_id,
      input.start_at,
      effectiveEnd,
      excludeId
    );
    if (patConflict) {
      return duplicateFailure(
        "patient_window",
        patConflict.id,
        "Patient already has another duty overlapping this time. Confirm to add anyway (relief / partner share)."
      );
    }
  }

  return success(null);
}

async function rollbackBillingFromDuty(
  duty: JsonRow,
  ctx: DutyServiceContext
): Promise<ApiResult<null>> {
  const billingId = (duty.billing_id as string | null) || "";
  const dutyId = String(duty.id);
  const access = dbAccess(ctx);

  const diaryRows = await dutyRepository.findSvcEntriesByDutyId(dutyId, access);
  if (!diaryRows.success) return passFailure<null>(diaryRows);

  const legacyRows = billingId
    ? await dutyRepository.findSvcEntriesForDuty(billingId, dutyId, access)
    : { success: true as const, data: [] as JsonRow[] };
  if (!legacyRows.success) return passFailure<null>(legacyRows);

  const hasLines =
    (diaryRows.data?.length || 0) > 0 || (legacyRows.data?.length || 0) > 0;

  if (billingId && hasLines) {
    const receipts = await dutyRepository.countActiveReceipts(billingId, access);
    if (!receipts.success) return passFailure<null>(receipts);
    const guard = canCancelDutyWithBilling(true, receipts.data ?? 0);
    if (!guard.success) {
      return failure(guard.error || "Cancellation blocked", guard.code, {
        ...((guard.details as object) || {}),
        billing_id: billingId
      });
    }
  }

  if (billingId && legacyRows.data?.length) {
    const cleanup = await dutyRepository.removeSvcEntriesForDuty(billingId, dutyId, access);
    if (!cleanup.success) return passFailure<null>(cleanup);
  }

  const diaryCleanup = await dutyDiaryService.rollbackDutyDiary(dutyId, ctx);
  if (!diaryCleanup.success) return passFailure<null>(diaryCleanup);

  return success(null);
}

/**
 * Per-duty billing/payout freeze signals for `buildDutyPermissions`.
 *
 * Business rule: a duty stays editable while its billing is NOT done and its
 * payout is still remaining. "Billing done" = a receipt exists on the duty's
 * (active) bill; "payout made" = the day is disbursed in hh_paid_transactions.
 * Freezing is per-day — `paidSlots` of `totalSlots` lets the UI tell a fully
 * locked duty from a partially locked one.
 */
async function dutyFreezeSignals(
  duty: JsonRow,
  ctx: DutyServiceContext
): Promise<{
  billHasReceipt: boolean;
  totalSlots: number;
  paidSlots: number;
  hasBillingServiceLine: boolean;
}> {
  const access = dbAccess(ctx);
  const { billingRepository } = await import("@/database/billingRepository");
  const patientId = String(duty.patient_id || "");
  let billingId = String(duty.billing_id || "");
  if (patientId) {
    const active = await billingRepository.findActiveByPatient(patientId, access);
    if (active.success && active.data) billingId = String(active.data.id);
  }

  let billHasReceipt = false;
  if (billingId) {
    const rc = await dutyRepository.countActiveReceipts(billingId, access);
    if (rc.success) billHasReceipt = (rc.data ?? 0) > 0;
  }

  const slots = await dutyDiaryService.collectDiaryPaidSlots(String(duty.id), ctx);
  const list = slots.success ? slots.data ?? [] : [];
  const totalSlots = list.length;
  let paidSlots = 0;
  // When the bill is already receipted every day is frozen, so the per-day
  // paid scan is redundant — skip the extra queries.
  if (!billHasReceipt) {
    for (const slot of list) {
      const paid = await payoutRepository.isDayPaid(slot.employee_id, slot.iso_date, access);
      if (paid.success && paid.data) paidSlots += 1;
    }
  }

  return { billHasReceipt, totalSlots, paidSlots, hasBillingServiceLine: totalSlots > 0 };
}

/** Attach server-computed permissions for duty mutation/read responses. */
async function decorateDutyPermissions(
  row: JsonRow,
  ctx: DutyServiceContext
): Promise<DutyApiRow> {
  const signals = await dutyFreezeSignals(row, ctx);
  const permissions = buildDutyPermissions({
    status: String(row.status || "SCHEDULED"),
    ...signals
  });
  return { ...row, permissions } as DutyApiRow;
}

async function payoutPeriodsTouchedByDuty(
  duty: JsonRow,
  ctx: DutyServiceContext
): Promise<Map<string, Set<string>>> {
  const access = dbAccess(ctx);
  const dutyId = String(duty.id || "");
  const periodsByEmployee = new Map<string, Set<string>>();

  function add(employeeId: string, isoDate: string) {
    const emp = String(employeeId || "").trim();
    const period = String(isoDate || "").slice(0, 7);
    if (!emp || !/^\d{4}-\d{2}$/.test(period)) return;
    const set = periodsByEmployee.get(emp) || new Set<string>();
    set.add(period);
    periodsByEmployee.set(emp, set);
  }

  const primaryId = String(duty.employee_id || "");
  const fallbackPeriod = payoutPeriodForDuty(
    String(duty.start_at || ""),
    new Date().toISOString()
  );
  add(primaryId, `${fallbackPeriod}-01`);

  try {
    const extra = Array.isArray(duty.extra_partners) ? duty.extra_partners : [];
    for (const item of extra) {
      const empId = String((item as { employee_id?: unknown }).employee_id || "");
      add(empId, `${fallbackPeriod}-01`);
    }
  } catch {
    /* ignore malformed extra_partners */
  }

  if (dutyId) {
    const payRows = await dutyRepository.findPayoutChargesByDutyId(dutyId, access);
    if (payRows.success) {
      for (const row of payRows.data || []) {
        const empId = String(row.partner_id || row.partner || "");
        add(empId, String(row.date || `${fallbackPeriod}-01`));
      }
    }
  }

  return periodsByEmployee;
}

async function recomputeAffectedPayoutPeriods(
  periodsByEmployee: Map<string, Set<string>>,
  ctx: DutyServiceContext,
  scope: string
): Promise<void> {
  const access = dbAccess(ctx);
  const tasks: Promise<unknown>[] = [];
  periodsByEmployee.forEach(function (periods, employeeId) {
    periods.forEach(function (period) {
      tasks.push(
        recomputePayoutIfEditable(employeeId, period, access).catch((err) => {
          console.error(`[dutyService.${scope}] recompute payout failed`, {
            employeeId,
            period,
            err
          });
        })
      );
    });
  });
  await Promise.all(tasks);
}

function mergePayoutPeriods(
  target: Map<string, Set<string>>,
  source: Map<string, Set<string>>
): Map<string, Set<string>> {
  source.forEach(function (periods, employeeId) {
    const set = target.get(employeeId) || new Set<string>();
    periods.forEach(function (period) {
      set.add(period);
    });
    target.set(employeeId, set);
  });
  return target;
}

export type DutyApiRow = JsonRow;

export const dutyService = {
  async list(
    rawQuery: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<{ rows: DutyApiRow[]; total: number }>> {
    const parsed = parseInput(dutyListQuerySchema, rawQuery);
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as DutyListQuery;

    const result = await dutyRepository.list(
      {
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        employeeId: query.employee_id,
        patientId: query.patient_id,
        status: query.status,
        from: query.from,
        to: query.to
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);

    // Bulk "billing done" lookup: one active bill per patient, then a single
    // batched receipt query. Per-day paid state is enforced server-side on
    // mutation; the list view only needs the bill-level (receipt) signal.
    const baseRows = result.data?.rows || [];
    const access = dbAccess(ctx);
    const { billingRepository } = await import("@/database/billingRepository");
    const patientIds = Array.from(
      new Set(baseRows.map((r) => String(r.patient_id || "")).filter(Boolean))
    );
    const billByPatient = new Map<string, string>();
    for (const pid of patientIds) {
      const active = await billingRepository.findActiveByPatient(pid, access);
      if (active.success && active.data) billByPatient.set(pid, String(active.data.id));
    }
    const billingIds = Array.from(new Set([...billByPatient.values()]));
    const receiptedBills = new Set<string>();
    if (billingIds.length) {
      const recs = await billingRepository.listActiveReceiptsByBillingIds(billingIds, access);
      if (recs.success) {
        for (const r of recs.data || []) receiptedBills.add(String(r.billing_id));
      }
    }

    const rows = baseRows.map((row) => {
      const billingId = billByPatient.get(String(row.patient_id || ""));
      const billHasReceipt = billingId ? receiptedBills.has(billingId) : false;
      return {
        ...row,
        permissions: buildDutyPermissions({
          status: String(row.status || "SCHEDULED"),
          billHasReceipt,
          hasBillingServiceLine: billHasReceipt
        })
      };
    });
    return success({
      rows,
      total: result.data?.total ?? 0
    });
  },

  async getById(id: string, ctx: DutyServiceContext): Promise<ApiResult<DutyApiRow>> {
    const loaded = await loadDuty(id, ctx);
    if (!loaded.success) return passFailure(loaded);
    // Decorate the read row with server-computed `permissions` so the UI
    // never re-derives duty policy. Sibling field is additive — existing
    // callers that ignore it stay compatible.
    const signals = await dutyFreezeSignals(loaded.data, ctx);
    const permissions = buildDutyPermissions({
      status: String(loaded.data.status || "SCHEDULED"),
      ...signals
    });
    return success({ ...loaded.data, permissions } as DutyApiRow);
  },

  async create(rawInput: unknown, ctx: DutyServiceContext): Promise<ApiResult<DutyApiRow>> {
    const parsed = parseInput(dutySchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as DutyInput;

    const overlap = await ensureNoOverlap(
      {
        ...input,
        confirm_staff_overlap: input.confirm_staff_overlap,
        confirm_patient_overlap: input.confirm_patient_overlap
      },
      input.id,
      ctx
    );
    if (!overlap.success) return passFailure(overlap);

    const id = input.id || newId.duty();
    const row = {
      ...dutyPersistRow({ ...input, id }),
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };

    const inserted = await dutyRepository.insert(row, dbAccess(ctx));
    if (!inserted.success) {
      const msg = (inserted.error || "").toLowerCase();
      if (msg.includes("hh_duties_patient_emp_no_overlap")) {
        return duplicateFailure(
          "patient_employee_window",
          id,
          "This carer already has an overlapping duty for this patient. Close " +
            "or cancel the existing duty first."
        );
      }
      if (msg.includes("hh_duties_no_overlap")) {
        return duplicateFailure("duty_window", id, "Staff already has a duty overlapping this time");
      }
      return passFailure(inserted);
    }
    const fresh = await loadFreshDuty(id, ctx, inserted.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    if (input.materialize) {
      const mat = await dutyDiaryService.materializeDuty(fresh.data, ctx);
      if (!mat.success) {
        // Compensating rollback: remove any partial ledger rows, then the duty.
        try {
          await dutyDiaryService.rollbackDutyDiary(id, ctx);
        } catch (err) {
          console.error("[dutyService.create] failed to rollback partial diary", { id, err });
        }
        try {
          await dutyRepository.remove(id, dbAccess(ctx));
        } catch (err) {
          console.error("[dutyService.create] failed to rollback unsynced duty", { id, err });
        }
        return passFailure(mat);
      }
      const affected = await payoutPeriodsTouchedByDuty(fresh.data, ctx);
      await recomputeAffectedPayoutPeriods(affected, ctx, "create");
    }

    const decorated = await decorateDutyPermissions(fresh.data, ctx);
    return finalizeWithAudit(
      await fireAudit(ctx, { entity_id: id, action: "create", after: decorated }),
      decorated
    );
  },

  async update(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);

    // Hard freeze guard: a duty whose billing is done (receipt) or whose every
    // day is already paid must not be edited or affected. Partially-locked
    // duties stay editable — the materializer skips the frozen days.
    const freezeSignals = await dutyFreezeSignals(existing.data, ctx);
    const freeze = computeDutyFreeze(freezeSignals);
    if (freeze.frozen) {
      return failure(
        freeze.reason || "Duty is locked by billing/payout and cannot be edited",
        ErrorCodes.business,
        freezeSignals
      );
    }

    const parsed = parseInput(dutySchema, { ...(rawInput as object), id });
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as DutyInput;

    const versionRequired = requireExpectedVersion("Duty", input.expected_updated_at);
    if (!versionRequired.success) return passFailure(versionRequired);

    const stale = assertNotStale("Duty", existing.data.updated_at, input.expected_updated_at);
    if (!stale.success) return passFailure(stale);

    const reopenCheck = canReopenCompletedDuty(String(existing.data.status || ""), input.status);
    if (!reopenCheck.success) {
      return failure(
        reopenCheck.error || "Completed duties cannot be reopened",
        reopenCheck.code,
        reopenCheck.details
      );
    }

    const editStatusCheck = canEditDutyStatus(String(existing.data.status || ""), input.status);
    if (!editStatusCheck.success) {
      return failure(
        editStatusCheck.error || "Illegal status transition for duty edit",
        editStatusCheck.code,
        editStatusCheck.details
      );
    }

    const affectedBefore = await payoutPeriodsTouchedByDuty(existing.data, ctx);

    const overlap = await ensureNoOverlap(
      {
        ...input,
        confirm_staff_overlap: input.confirm_staff_overlap,
        confirm_patient_overlap: input.confirm_patient_overlap
      },
      id,
      ctx
    );
    if (!overlap.success) return passFailure(overlap);

    const patch = {
      ...dutyPersistRow({ ...input, id }),
      updated_by: ctx.actor.email
    };
    const updated = await dutyRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) {
      const msg = (updated.error || "").toLowerCase();
      if (msg.includes("hh_duties_patient_emp_no_overlap")) {
        return duplicateFailure(
          "patient_employee_window",
          id,
          "This carer already has an overlapping duty for this patient. Close " +
            "or cancel the existing duty first."
        );
      }
      if (msg.includes("hh_duties_no_overlap")) {
        return duplicateFailure("duty_window", id, "Staff already has a duty overlapping this time");
      }
      return passFailure(updated);
    }

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    if (input.materialize) {
      const mat = await dutyDiaryService.materializeDuty(fresh.data, ctx);
      if (!mat.success) {
        // Compensating rollback: restore the duty row and re-materialize the
        // previous ledger so a failed sync never leaves a half-applied state.
        try {
          const revertPatch = {
            ...dutyPersistRow({
              id,
              patient_id: String(existing.data.patient_id || ""),
              employee_id: String(existing.data.employee_id || ""),
              service_name: String(existing.data.service_name || existing.data.service_type || ""),
              service_type: String(existing.data.service_type || existing.data.service_name || ""),
              shift_type: (String(existing.data.shift_type || "DAY") || "DAY") as DutyShiftType,
              start_at: String(existing.data.start_at || ""),
              end_at: (existing.data.end_at as string | null) ?? undefined,
              status: String(existing.data.status || "SCHEDULED") as DutyStatus,
              charge_per_day: Number(existing.data.charge_per_day ?? 0),
              payout_per_day: Number(existing.data.payout_per_day ?? 0),
              payout_term: String(existing.data.payout_term || "Daily"),
              extra_partners: existing.data.extra_partners,
              excluded_days: existing.data.excluded_days
            }),
            updated_by: ctx.actor.email
          };
          await dutyRepository.update(id, revertPatch, dbAccess(ctx));
          await dutyDiaryService.materializeDuty(existing.data, ctx);
        } catch (err) {
          console.error("[dutyService.update] failed to restore duty after materialize error", {
            id,
            err
          });
        }
        return passFailure(mat);
      }
      const affectedAfter = await payoutPeriodsTouchedByDuty(fresh.data, ctx);
      const affected = mergePayoutPeriods(affectedBefore, affectedAfter);
      await recomputeAffectedPayoutPeriods(affected, ctx, "update");
    }

    const decorated = await decorateDutyPermissions(fresh.data, ctx);
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: decorated
      }),
      decorated
    );
  },

  /**
   * Totals for the duty-form summary banner: patient outstanding across all
   * bills + partner payout (all hh_payout_charges to that employee, less paid).
   */
  async totalsFor(
    patientId: string | undefined,
    employeeId: string | undefined,
    ctx: DutyServiceContext,
    options?: { period?: string }
  ): Promise<
    ApiResult<{
      patient: {
        patient_id: string;
        bills: number;
        billed: number;
        received: number;
        outstanding: number;
        sec_dep: number;
      } | null;
      partner: {
        employee_id: string;
        charged: number;
        paid: number;
        pending: number;
      } | null;
    }>
  > {
    const access = dbAccess(ctx);
    const { billingRepository } = await import("@/database/billingRepository");
    const { computeBillingTotals } = await import("@/business/billingRules");

    let patientSummary: {
      patient_id: string;
      bills: number;
      billed: number;
      received: number;
      outstanding: number;
      sec_dep: number;
    } | null = null;

    if (patientId) {
      const bills = await billingRepository.listBillingsByPatient(patientId, access);
      if (!bills.success) return passFailure(bills);
      const billRows = bills.data || [];
      // P1-25: batched fetch — two round-trips instead of 2N. For a
      // long-running patient with 80+ bills the per-bill loop spent ~6 s
      // round-tripping at 30 ms each; the in-clause fetch lands in ~120 ms.
      const billingIds = billRows.map((b) => String(b.id));
      let billed = 0;
      let received = 0;
      let outstanding = 0;
      let secDep = 0;
      if (billingIds.length > 0) {
        const [svcAll, rcptAll] = await Promise.all([
          billingRepository.listSvcByBillingIds(billingIds, access),
          billingRepository.listActiveReceiptsByBillingIds(billingIds, access)
        ]);
        if (!svcAll.success) return passFailure(svcAll);
        if (!rcptAll.success) return passFailure(rcptAll);
        const svcByBilling = new Map<string, JsonRow[]>();
        for (const row of svcAll.data || []) {
          const key = String(row.billing_id || "");
          if (!svcByBilling.has(key)) svcByBilling.set(key, []);
          svcByBilling.get(key)!.push(row);
        }
        const rcptByBilling = new Map<string, JsonRow[]>();
        for (const row of rcptAll.data || []) {
          const key = String(row.billing_id || "");
          if (!rcptByBilling.has(key)) rcptByBilling.set(key, []);
          rcptByBilling.get(key)!.push(row);
        }
        for (const b of billRows) {
          const bid = String(b.id);
          const t = computeBillingTotals({
            services: svcByBilling.get(bid) || [],
            receipts: rcptByBilling.get(bid) || [],
            secDep: Number(b.sec_dep || 0)
          });
          billed += t.services;
          received += t.receipts;
          outstanding += t.outstanding;
          secDep += t.sec_dep;
        }
      }
      patientSummary = {
        patient_id: patientId,
        bills: billRows.length,
        billed,
        received,
        outstanding,
        sec_dep: secDep
      };
    }

    let partnerSummary: {
      employee_id: string;
      charged: number;
      paid: number;
      pending: number;
      period_month?: string;
    } | null = null;
    if (employeeId) {
      const period = String(options?.period || "").trim();
      if (period) {
        // Single source of truth: read the period payout via the central
        // duty-ledger authority (same hh_payout_charges math everywhere).
        const { getEmployeePayoutLedger } = await import("@/src/lib/duty-ledger");
        const ledger = await getEmployeePayoutLedger(employeeId, period, access);
        if (!ledger.success) return passFailure(ledger);
        partnerSummary = {
          employee_id: employeeId,
          charged: Number(ledger.data?.gross || 0),
          paid: Number(ledger.data?.paid || 0),
          pending: Number(ledger.data?.outstanding || 0),
          period_month: period
        };
      } else {
        const db = (await import("@/database/supabaseClient")).runListQuery;
        const { resolveClient } = await import("@/database/baseRepository");
        const client = resolveClient(access);
        const chargesRes = await db<{ amount?: number | string | null }>(
          () =>
            client
              .from("hh_payout_charges")
              .select("amount")
              .eq("partner_id", employeeId),
          "dutyService.totalsFor.charges"
        );
        if (!chargesRes.success) return passFailure(chargesRes);
        const paidRes = await db<{ amount?: number | string | null }>(
          () =>
            client
              .from("hh_paid_transactions")
              .select("amount")
              .or(`employee_id.eq.${employeeId},partner.eq.${employeeId}`),
          "dutyService.totalsFor.paid"
        );
        if (!paidRes.success) return passFailure(paidRes);
        const charged = (chargesRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
        const paid = (paidRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
        partnerSummary = {
          employee_id: employeeId,
          charged,
          paid,
          pending: Math.max(0, charged - paid)
        };
      }
    }

    return success({ patient: patientSummary, partner: partnerSummary });
  },

  async materialize(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<import("@/services/dutyDiaryService").MaterializeResult>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);

    const parsed = parseInput(dutyMaterializeSchema, rawInput ?? {});
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as DutyMaterializeInput;

    return dutyDiaryService.materializeDuty(existing.data, ctx, {
      from: input.from,
      to: input.to,
      dry_run: input.dry_run
    });
  },

  /**
   * Daily extend: for every SCHEDULED / IN_PROGRESS duty, materialize
   * per-day rows up to today. Open-ended duties (sentinel end_at) accrue
   * one new charge + payout per partner per day. Designed to be hit by
   * a Vercel Cron so the duty calendar is always in sync without the
   * operator clicking "Sync diary" manually.
   *
   * Patient-scoped variant is available via `extendForPatient(patientId)`.
   * It is intentionally called from mutation/sync flows, not from ordinary
   * billing detail reads, so opening a patient bill remains fast.
   */
  async extendActive(
    ctx: DutyServiceContext
  ): Promise<
    ApiResult<{
      processed: number;
      created_svc: number;
      created_payout: number;
      updated_svc: number;
      updated_payout: number;
      deleted_svc: number;
      deleted_payout: number;
      skipped: number;
      skipped_no_bill: number;
      errors: { duty_id: string; error: string }[];
    }>
  > {
    return runExtendOverDuties(
      () => dutyRepository.findActive(dbAccess(ctx)),
      ctx,
      { audit: true }
    );
  },

  /**
   * Cron-safe catch-up: process only active duties that are missing today's
   * materialized billing/payout row. This keeps the live cron request short
   * and avoids re-walking every already-synced duty.
   */
  async extendDue(
    ctx: DutyServiceContext,
    options?: { today?: string; limit?: number }
  ): Promise<
    ApiResult<{
      processed: number;
      created_svc: number;
      created_payout: number;
      updated_svc: number;
      updated_payout: number;
      deleted_svc: number;
      deleted_payout: number;
      skipped: number;
      skipped_no_bill: number;
      errors: { duty_id: string; error: string }[];
    }>
  > {
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.today || ""))
      ? String(options?.today)
      : new Date().toISOString().slice(0, 10);
    const limit = Math.max(1, Math.min(50, Math.floor(Number(options?.limit) || 20)));
    return runExtendOverDuties(
      () => dutyRepository.findActiveNeedingExtension(today, limit, dbAccess(ctx)),
      ctx,
      { audit: true, from: today, to: today, prune: false }
    );
  },

  /**
   * Database-side daily materialization for production cron. This is the
   * durable path for open-ended duties: one Supabase transaction inserts the
   * missing hh_svc_entries + hh_payout_charges rows and unique indexes prevent
   * duplicate patient/staff/day billing.
   */
  async bulkExtendDue(
    ctx: DutyServiceContext,
    options?: { from?: string; to?: string; limit?: number }
  ): Promise<ApiResult<import("@/database/dutyRepository").BulkDutyMaterializeResult | null>> {
    const today = new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.from || ""))
      ? String(options?.from)
      : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.to || ""))
      ? String(options?.to)
      : from;
    const limit = Math.max(1, Math.min(1000, Math.floor(Number(options?.limit) || 500)));
    return dutyRepository.bulkMaterializeDueDutyDays(
      from,
      to,
      limit,
      ctx.actor.email || "cron@hominal.system",
      dbAccess(ctx)
    );
  },

  /**
   * Reconcile the downstream ledgers that must mirror duty diary rows.
   * This is intentionally database-side so attendance + payouts are updated
   * from the same source-of-truth snapshot and the cron cannot leave partial
   * frontend-only state behind.
   */
  async syncDutyAttendancePayoutLedger(
    ctx: DutyServiceContext,
    options?: { from?: string; to?: string }
  ): Promise<ApiResult<import("@/database/dutyRepository").DutyLedgerSyncResult | null>> {
    const today = new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.from || ""))
      ? String(options?.from)
      : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.to || ""))
      ? String(options?.to)
      : from;
    return dutyRepository.syncDutyAttendancePayoutLedger(
      from,
      to,
      ctx.actor.email || "cron@hominal.system",
      dbAccess(ctx)
    );
  },

  /**
   * Same materialize loop as `extendActive` but scoped to a single
   * patient. Called by the explicit duty-ledger sync path so operators can
   * reconcile one patient's calendar without blocking normal billing reads.
   *
   * Mutations are intentionally suppressed when there's nothing to
   * write (audit log noise, idempotent) and errors are isolated per
   * duty so one bad row never blocks the whole bill.
   */
  async extendForPatient(
    patientId: string,
    ctx: DutyServiceContext
  ): Promise<
    ApiResult<{
      processed: number;
      created_svc: number;
      created_payout: number;
      updated_svc: number;
      updated_payout: number;
      deleted_svc: number;
      deleted_payout: number;
      skipped: number;
      skipped_no_bill: number;
      errors: { duty_id: string; error: string }[];
    }>
  > {
    const pid = String(patientId || "").trim();
    if (!pid) {
      return success({
        processed: 0,
        created_svc: 0,
        created_payout: 0,
        updated_svc: 0,
        updated_payout: 0,
        deleted_svc: 0,
        deleted_payout: 0,
        skipped: 0,
        skipped_no_bill: 0,
        errors: []
      });
    }
    return runExtendOverDuties(
      () => dutyRepository.findMaterializableByPatient(pid, dbAccess(ctx)),
      ctx,
      { audit: false }
    );
  },

  async assignPartners(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<
    ApiResult<{ duty: DutyApiRow; materialize?: import("@/services/dutyDiaryService").MaterializeResult }>
  > {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);

    const parsed = parseInput(dutyPartnersSchema, rawInput ?? {});
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as DutyPartnersInput;

    return dutyDiaryService.assignExtraPartners(
      existing.data,
      input.extra_partners,
      ctx,
      input.materialize ?? true
    );
  },

  /**
   * Cancel a duty + roll back any service-entry it produced.
   * If receipts exist against the parent billing, fail loudly: we never
   * silently corrupt finance data.
   */
  async cancel(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);

    const parsed = parseInput(dutyCancelSchema, rawInput ?? {});
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as DutyCancelInput;

    const cancelGuard = canCancelDuty(String(existing.data.status || ""));
    if (!cancelGuard.success) {
      return failure(
        cancelGuard.error || "Cannot cancel this duty",
        cancelGuard.code,
        cancelGuard.details
      );
    }

    const affectedPayoutPeriods = await payoutPeriodsTouchedByDuty(existing.data, ctx);
    const rollback = await rollbackBillingFromDuty(existing.data, ctx);
    if (!rollback.success) return passFailure(rollback);

    const patch = dutyCancellationPatch(ctx.actor.email, input.reason);
    const updated = await dutyRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    // Clean up the orphan attendance row so the staff report doesn't
    // keep showing a cancelled duty as PRESENT. Best-effort — failure
    // here is logged but doesn't undo the cancellation.
    try {
      await syncDutyCancelledAbsent(id, input.reason || "no reason", ctx);
    } catch (err) {
      console.error("[dutyService.cancel] attendance cleanup failed", err);
    }

    // Recompute every employee/month that had payout charge rows removed.
    // Capture happens before rollback so reassignments and cross-month duties
    // do not leave ghost pending payout balances after refresh.
    await recomputeAffectedPayoutPeriods(affectedPayoutPeriods, ctx, "cancel");

    const decorated = await decorateDutyPermissions(fresh.data, ctx);
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "delete",
        before: existing.data,
        after: decorated,
        stamp: `Cancelled: ${input.reason}`
      }),
      decorated
    );
  },

  /** Public alias — `DELETE /duties/[id]` should call cancel, never hard-delete. */
  remove(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    return dutyService.cancel(id, rawInput, ctx);
  },

  /**
   * Soft-delete a duty: marks status DELETED, rolls back diary rows, and
   * keeps the row for audit. Refuses if the bill already has receipts.
   * Admin-only (`DELETE ?hard=1`).
   */
  async hardDelete(
    id: string,
    ctx: DutyServiceContext
  ): Promise<ApiResult<{ id: string; deleted: true }>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);

    const deleteGuard = canDeleteDuty(String(existing.data.status || ""));
    if (!deleteGuard.success) {
      return failure(
        deleteGuard.error || "Cannot delete this duty",
        deleteGuard.code,
        deleteGuard.details
      );
    }

    const affectedPayoutPeriods = await payoutPeriodsTouchedByDuty(existing.data, ctx);
    const rollback = await rollbackBillingFromDuty(existing.data, ctx);
    if (!rollback.success) return passFailure(rollback);

    const access = dbAccess(ctx);
    const patch = dutyDeletionPatch(ctx.actor.email);
    const updated = await dutyRepository.update(id, patch, access);
    if (!updated.success) return passFailure(updated);

    try {
      await syncDutyCancelledAbsent(id, "Duty deleted", ctx);
    } catch (err) {
      console.error("[dutyService.hardDelete] attendance cleanup failed", err);
    }

    await recomputeAffectedPayoutPeriods(affectedPayoutPeriods, ctx, "hardDelete");

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "delete",
        before: existing.data,
        after: fresh.success ? fresh.data : updated.data,
        stamp: "Soft delete (duty marked DELETED, diary rolled back)"
      }),
      { id, deleted: true as const }
    );
  },

  async checkIn(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    const parsed = parseInput(dutyCheckAtSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const at = (parsed.data as DutyCheckAtInput).at;

    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);
    const access = dbAccess(ctx);
    const checkInAt = at || new Date().toISOString();

    const employeeId = String(existing.data.employee_id || "");
    const patientId = String(existing.data.patient_id || "");

    await syncDutyCheckIn(
      id,
      employeeId,
      patientId,
      checkInAt,
      (existing.data.shift_type as string | undefined) || undefined,
      ctx
    );

    const patch = dutyCheckInPatch(ctx.actor.email);
    const updated = await dutyRepository.update(id, patch, access);
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    const decorated = await decorateDutyPermissions(fresh.data, ctx);
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: decorated,
        stamp: "Check-in"
      }),
      decorated
    );
  },

  async checkOut(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    const parsed = parseInput(dutyCheckAtSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const at = (parsed.data as DutyCheckAtInput).at;

    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);
    const access = dbAccess(ctx);
    const checkOutAt = at || new Date().toISOString();

    const attendanceLookup = await attendanceRepository.findByDutyAndEmployee(
      id,
      String(existing.data.employee_id || ""),
      access
    );
    if (!attendanceLookup.success) return passFailure(attendanceLookup);
    if (!attendanceLookup.data) {
      return failure("Duty has no check-in record", ErrorCodes.badRequest);
    }

    const checkInAt = String(attendanceLookup.data.check_in_at || "");
    const hours = hoursBetween(checkInAt, checkOutAt);

    await syncDutyCheckOut(
      id,
      String(attendanceLookup.data.employee_id || existing.data.employee_id || ""),
      checkOutAt,
      ctx
    );

    const patch = dutyCheckOutPatch(ctx.actor.email);
    const updated = await dutyRepository.update(id, patch, access);
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    const employeeId = String(existing.data.employee_id || "");
    if (employeeId) {
      const period = payoutPeriodForDuty(String(existing.data.start_at || ""), checkOutAt);
      // Recompute for the primary partner AND any partner that owns a
      // payout row on this duty (per-day reassignments / extra_partners).
      const partnerIds = new Set<string>([employeeId]);
      const payRows = await dutyRepository.findPayoutChargesByDutyId(id, access);
      if (payRows.success) {
        for (const row of payRows.data || []) {
          const p = String(row.partner_id || "");
          if (p) partnerIds.add(p);
        }
      }
      await Promise.all(
        Array.from(partnerIds).map((empId) =>
          recomputePayoutIfEditable(empId, period, access)
        )
      );
    }

    const decorated = await decorateDutyPermissions(fresh.data, ctx);
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: decorated,
        stamp: `Check-out (${hours.toFixed(2)}h)`
      }),
      decorated
    );
  }
};

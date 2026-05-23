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
  dutyListQuerySchema,
  dutyMaterializeSchema,
  dutyPartnersSchema,
  type DutyInput,
  type DutyCancelInput,
  type DutyListQuery,
  type DutyMaterializeInput,
  type DutyPartnersInput,
  type DutyStatus
} from "@/validation/dutyValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  canCancelDutyWithBilling,
  canEditDutyStatus,
  canReopenCompletedDuty,
  dutyCancellationPatch,
  dutyCheckInPatch,
  dutyCheckOutPatch,
  dutyPersistRow,
  payoutPeriodForDuty,
  selectOverlappingDuty,
  shouldCheckDutyOverlap,
  type DutyTimeSlot
} from "@/business/dutyRules";
import { assertNotStale } from "@/business/concurrencyRules";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { hoursBetween } from "@/business/attendanceRules";
import { newId } from "@/business/idRules";
import { dutyRepository } from "@/database/dutyRepository";
import { attendanceRepository } from "@/database/attendanceRepository";
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

export interface ActorLike {
  email: string;
  role?: string;
  accessToken?: string;
}

export interface DutyServiceContext {
  actor: ActorLike;
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
    end_at: string;
    status: DutyStatus;
    confirm_staff_overlap?: boolean;
  },
  excludeId: string | undefined,
  ctx: DutyServiceContext
): Promise<ApiResult<null>> {
  if (!shouldCheckDutyOverlap(input.status)) return success(null);
  if (input.confirm_staff_overlap) return success(null);
  const access = dbAccess(ctx);

  const empRows = await dutyRepository.findOverlapping(
    input.employee_id,
    input.start_at,
    input.end_at,
    excludeId,
    access
  );
  if (!empRows.success) return passFailure<null>(empRows);
  const empConflict = selectOverlappingDuty(
    (empRows.data || []).map(asSlot),
    input.employee_id,
    input.start_at,
    input.end_at,
    excludeId
  );
  if (empConflict) {
    return duplicateFailure(
      "employee_window",
      empConflict.id,
      "Staff already has a duty overlapping this time. Confirm to assign anyway (relief / partner share)."
    );
  }

  // Legacy CRM allows multiple partners on one patient per day (svc diary);
  // only the same employee on the same window needs explicit confirmation.

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
    return success({
      rows: result.data?.rows || [],
      total: result.data?.total ?? 0
    });
  },

  async getById(id: string, ctx: DutyServiceContext): Promise<ApiResult<DutyApiRow>> {
    return loadDuty(id, ctx);
  },

  async create(rawInput: unknown, ctx: DutyServiceContext): Promise<ApiResult<DutyApiRow>> {
    const parsed = parseInput(dutySchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as DutyInput;

    const overlap = await ensureNoOverlap(
      { ...input, confirm_staff_overlap: input.confirm_staff_overlap },
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
      if (msg.includes("hh_duties_no_overlap")) {
        return duplicateFailure("duty_window", id, "Staff already has a duty overlapping this time");
      }
      return passFailure(inserted);
    }
    const fresh = await loadFreshDuty(id, ctx, inserted.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    if (input.materialize) {
      const mat = await dutyDiaryService.materializeDuty(fresh.data, ctx);
      if (!mat.success) return passFailure(mat);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, { entity_id: id, action: "create", after: fresh.data }),
      fresh.data
    );
  },

  async update(
    id: string,
    rawInput: unknown,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);

    const parsed = parseInput(dutySchema, { ...(rawInput as object), id });
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as DutyInput;

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

    const overlap = await ensureNoOverlap(
      { ...input, confirm_staff_overlap: input.confirm_staff_overlap },
      id,
      ctx
    );
    if (!overlap.success) return passFailure(overlap);

    const patch = {
      ...dutyPersistRow({ ...input, id }),
      updated_by: ctx.actor.email
    };
    const updated = await dutyRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    if (input.materialize) {
      const mat = await dutyDiaryService.materializeDuty(fresh.data, ctx);
      if (!mat.success) return passFailure(mat);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data
      }),
      fresh.data
    );
  },

  /**
   * Totals for the duty-form summary banner: patient outstanding across all
   * bills + partner payout (all hh_payout_charges to that employee, less paid).
   */
  async totalsFor(
    patientId: string | undefined,
    employeeId: string | undefined,
    ctx: DutyServiceContext
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
      let billed = 0;
      let received = 0;
      let outstanding = 0;
      let secDep = 0;
      for (const b of billRows) {
        const bid = String(b.id);
        const [svc, rcpt] = await Promise.all([
          billingRepository.listSvcByBilling(bid, access),
          billingRepository.listActiveReceiptsByBilling(bid, access)
        ]);
        if (!svc.success) return passFailure(svc);
        if (!rcpt.success) return passFailure(rcpt);
        const t = computeBillingTotals({
          services: svc.data || [],
          receipts: rcpt.data || [],
          secDep: Number(b.sec_dep || 0)
        });
        billed += t.services;
        received += t.receipts;
        outstanding += t.outstanding;
        secDep += t.sec_dep;
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

    let partnerSummary: { employee_id: string; charged: number; paid: number; pending: number } | null = null;
    if (employeeId) {
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
            .eq("employee_id", employeeId),
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

    const rollback = await rollbackBillingFromDuty(existing.data, ctx);
    if (!rollback.success) return passFailure(rollback);

    const patch = dutyCancellationPatch(ctx.actor.email, input.reason);
    const updated = await dutyRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    // Recompute payout for the duty's own month so cancelled hours don't
    // linger in the staff's payslip.
    const employeeId = (existing.data.employee_id as string | undefined) || "";
    if (employeeId) {
      const period = payoutPeriodForDuty(
        String(existing.data.start_at || ""),
        new Date().toISOString()
      );
      await payoutRepository.recomputeRpc(employeeId, period, dbAccess(ctx));
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "delete",
        before: existing.data,
        after: fresh.data,
        stamp: `Cancelled: ${input.reason || "no reason"}`
      }),
      fresh.data
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
   * Hard-delete a duty + all of its diary rows. Refuses if the bill already
   * has receipts (we never silently corrupt finance data).
   * Admin-only.
   */
  async hardDelete(
    id: string,
    ctx: DutyServiceContext
  ): Promise<ApiResult<{ id: string; deleted: true }>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);

    const rollback = await rollbackBillingFromDuty(existing.data, ctx);
    if (!rollback.success) return passFailure(rollback);

    const access = dbAccess(ctx);
    const removed = await dutyRepository.remove(id, access);
    if (!removed.success) return passFailure(removed);

    const employeeId = (existing.data.employee_id as string | undefined) || "";
    if (employeeId) {
      const period = payoutPeriodForDuty(
        String(existing.data.start_at || ""),
        new Date().toISOString()
      );
      await payoutRepository.recomputeRpc(employeeId, period, access);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "delete",
        before: existing.data,
        after: null,
        stamp: "Hard delete (duty + diary)"
      }),
      { id, deleted: true as const }
    );
  },

  async checkIn(
    id: string,
    at: string | undefined,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);
    const access = dbAccess(ctx);
    const checkInAt = at || new Date().toISOString();

    const employeeId = String(existing.data.employee_id || "");
    const patientId = String(existing.data.patient_id || "");

    const attendanceLookup = await attendanceRepository.findByDutyId(id, access);
    if (!attendanceLookup.success) return passFailure(attendanceLookup);

    if (attendanceLookup.data) {
      const updateAttendance = await attendanceRepository.update(
        String(attendanceLookup.data.id),
        {
          check_in_at: checkInAt,
          status: "PRESENT",
          updated_by: ctx.actor.email
        },
        access
      );
      if (!updateAttendance.success) return passFailure(updateAttendance);
    } else {
      const insertAttendance = await attendanceRepository.insert(
        {
          id: newId.attendance(),
          duty_id: id,
          employee_id: employeeId,
          patient_id: patientId,
          check_in_at: checkInAt,
          status: "PRESENT",
          created_by: ctx.actor.email,
          updated_by: ctx.actor.email
        },
        access
      );
      if (!insertAttendance.success) return passFailure(insertAttendance);
    }

    const patch = dutyCheckInPatch(ctx.actor.email);
    const updated = await dutyRepository.update(id, patch, access);
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: "Check-in"
      }),
      fresh.data
    );
  },

  async checkOut(
    id: string,
    at: string | undefined,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DutyApiRow>> {
    const existing = await loadDuty(id, ctx);
    if (!existing.success) return passFailure(existing);
    const access = dbAccess(ctx);
    const checkOutAt = at || new Date().toISOString();

    const attendanceLookup = await attendanceRepository.findByDutyId(id, access);
    if (!attendanceLookup.success) return passFailure(attendanceLookup);
    if (!attendanceLookup.data) {
      return failure("Duty has no check-in record", ErrorCodes.badRequest);
    }

    const attendanceRow = await attendanceRepository.findById(
      String(attendanceLookup.data.id),
      access
    );
    if (!attendanceRow.success) return passFailure(attendanceRow);
    if (!attendanceRow.data) {
      return failure("Attendance record vanished mid-checkout", ErrorCodes.internal);
    }

    const checkInAt = String(attendanceRow.data.check_in_at || "");
    const hours = hoursBetween(checkInAt, checkOutAt);

    const updateAttendance = await attendanceRepository.update(
      String(attendanceRow.data.id),
      {
        check_out_at: checkOutAt,
        hours,
        updated_by: ctx.actor.email
      },
      access
    );
    if (!updateAttendance.success) return passFailure(updateAttendance);

    const patch = dutyCheckOutPatch(ctx.actor.email);
    const updated = await dutyRepository.update(id, patch, access);
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshDuty(id, ctx, updated.data ?? null);
    if (!fresh.success) return passFailure(fresh);

    const employeeId = String(existing.data.employee_id || "");
    if (employeeId) {
      const period = payoutPeriodForDuty(String(existing.data.start_at || ""), checkOutAt);
      await payoutRepository.recomputeRpc(employeeId, period, access);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: `Check-out (${hours.toFixed(2)}h)`
      }),
      fresh.data
    );
  }
};

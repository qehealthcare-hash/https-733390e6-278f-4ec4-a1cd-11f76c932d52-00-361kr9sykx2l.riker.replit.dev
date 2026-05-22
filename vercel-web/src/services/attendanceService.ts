/**
 * Attendance service — corporate-grade layered facade.
 *
 * Composes /src/validation/attendanceValidation + /src/business/attendanceRules
 * + /src/database/attendanceRepository + /src/database/payoutRepository +
 * /src/database/dutyRepository + /src/database/auditRepository.
 *
 * Hardened rules (Phase 5 Attendance):
 *   - Status / dates / shift validated via Zod with cross-field guards.
 *   - PRESENT/LATE/HALF_DAY rows are anchored to either a duty or a check-in
 *     timestamp; ABSENT/LEAVE/HOLIDAY rows store no clock fields.
 *   - Duplicate prevention: same employee + duty (when duty_id set), else
 *     same employee + calendar date (UTC). UQ constraint
 *     `uq_hh_attendance_per_duty` is also surfaced via a friendly error.
 *   - Every mutation triggers `payoutRepository.recomputeRpc` for the
 *     attendance's own YYYY-MM (falling back to duty start, then today).
 *   - Every mutation refetches the persisted row and writes an audit log.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import {
  attendanceSchema,
  attendanceListQuerySchema,
  type AttendanceInput,
  type AttendanceListQuery
} from "@/validation/attendanceValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  ATTENDANCE_NO_TIME_STATUSES,
  attendanceDateKey,
  attendancePayoutPeriod,
  buildAttendancePatch,
  buildAttendanceRow,
  ensureAttendanceHasAnchor,
  findAttendanceDuplicate,
  hoursBetween,
  type AttendancePersistInput,
  type AttendanceRow
} from "@/business/attendanceRules";
import { newId } from "@/business/idRules";
import { attendanceRepository } from "@/database/attendanceRepository";
import { dutyRepository } from "@/database/dutyRepository";
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

export interface AttendanceServiceContext {
  actor: ActorLike;
  /** Optional override; defaults to actor.accessToken. */
  accessToken?: string;
}

function dbAccess(ctx: AttendanceServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function fireAudit(
  ctx: AttendanceServiceContext,
  payload: {
    entity_id: string;
    action: "create" | "update" | "delete";
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module: "attendance",
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

async function loadAttendance(
  id: string,
  ctx: AttendanceServiceContext
): Promise<LoadResult<JsonRow>> {
  const row = await attendanceRepository.findById(id, dbAccess(ctx));
  if (!row.success) return toLoadFailure(row);
  if (!row.data) return toLoadFailure(notFoundFailure("Attendance", id));
  return { success: true, data: row.data };
}

async function loadFreshAttendance(
  id: string,
  ctx: AttendanceServiceContext,
  fallback?: JsonRow | null
): Promise<LoadResult<JsonRow>> {
  const refreshed = await attendanceRepository.findById(id, dbAccess(ctx));
  if (!refreshed.success) return toLoadFailure(refreshed);
  const row = refreshed.data ?? fallback ?? null;
  if (!row) return toLoadFailure(failure("Attendance not found after mutation", ErrorCodes.internal));
  return { success: true, data: row };
}

function toAttendanceRow(row: JsonRow): AttendanceRow {
  return {
    id: String(row.id),
    duty_id: (row.duty_id as string | null) ?? null,
    employee_id: String(row.employee_id || ""),
    patient_id: (row.patient_id as string | null) ?? null,
    shift_type: (row.shift_type as string | null) ?? null,
    check_in_at: (row.check_in_at as string | null) ?? null,
    check_out_at: (row.check_out_at as string | null) ?? null,
    hours: typeof row.hours === "number" ? row.hours : Number(row.hours ?? 0) || 0,
    status: String(row.status || "PRESENT"),
    notes: (row.notes as string | null) ?? null
  };
}

async function checkDuplicate(
  input: AttendancePersistInput,
  excludeId: string | undefined,
  ctx: AttendanceServiceContext
): Promise<ApiResult<null>> {
  const access = dbAccess(ctx);

  if (input.duty_id) {
    const existing = await attendanceRepository.findByDutyId(input.duty_id, access);
    if (!existing.success) return passFailure<null>(existing);
    if (existing.data && String(existing.data.id) !== excludeId) {
      return duplicateFailure(
        "duty_id",
        input.duty_id,
        "Attendance already recorded for this duty"
      );
    }
    return success(null);
  }

  const dateKey = attendanceDateKey(input.check_in_at);
  const candidates = await attendanceRepository.findByEmployeeAndDate(
    input.employee_id,
    dateKey,
    access
  );
  if (!candidates.success) return passFailure<null>(candidates);
  const conflict = findAttendanceDuplicate(
    (candidates.data || []).map(toAttendanceRow),
    input.employee_id,
    undefined,
    dateKey,
    excludeId
  );
  if (conflict) {
    return duplicateFailure(
      "employee_date",
      `${input.employee_id}@${dateKey}`,
      "Attendance already recorded for this employee on this date"
    );
  }
  return success(null);
}

async function recomputePayoutFor(
  row: JsonRow,
  ctx: AttendanceServiceContext
): Promise<void> {
  const employeeId = String(row.employee_id || "");
  if (!employeeId) return;
  let dutyStart: string | undefined;
  const dutyId = (row.duty_id as string | null) || "";
  if (dutyId) {
    const duty = await dutyRepository.findById(dutyId, dbAccess(ctx));
    if (duty.success && duty.data) {
      dutyStart = (duty.data.start_at as string | undefined) || undefined;
    }
  }
  const period = attendancePayoutPeriod(
    (row.check_in_at as string | null) || undefined,
    dutyStart
  );
  if (!period) return;
  await payoutRepository.recomputeRpc(employeeId, period, dbAccess(ctx));
}

function inferUniqueViolation(error: string | undefined): boolean {
  const msg = String(error || "").toLowerCase();
  return (
    msg.includes("uq_hh_attendance_per_duty") ||
    msg.includes("duplicate key value") ||
    msg.includes("unique constraint")
  );
}

export type AttendanceApiRow = JsonRow;

export const attendanceService = {
  async list(
    rawQuery: unknown,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<{ rows: AttendanceApiRow[]; total: number }>> {
    const parsed = parseInput(attendanceListQuerySchema, rawQuery);
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as AttendanceListQuery;

    const result = await attendanceRepository.list(
      {
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        employeeId: query.employee_id,
        dutyId: query.duty_id,
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

  async getById(
    id: string,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<AttendanceApiRow>> {
    const loaded = await loadAttendance(id, ctx);
    if (!loaded.success) {
      return failure(loaded.error || "Attendance not found", loaded.code, loaded.details);
    }
    return success(loaded.data);
  },

  async create(
    rawInput: unknown,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<AttendanceApiRow>> {
    const parsed = parseInput(attendanceSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as AttendanceInput;

    const anchor = ensureAttendanceHasAnchor(input as AttendancePersistInput);
    if (!anchor.success) {
      return failure(anchor.error || "Anchor missing", anchor.code, anchor.details);
    }

    const dup = await checkDuplicate(input as AttendancePersistInput, input.id, ctx);
    if (!dup.success) return passFailure(dup);

    const fallbackId = input.id || newId.attendance();
    const row = buildAttendanceRow(input as AttendancePersistInput, ctx.actor.email, fallbackId);

    const inserted = await attendanceRepository.insert(row, dbAccess(ctx));
    if (!inserted.success) {
      if (inferUniqueViolation(inserted.error)) {
        return duplicateFailure(
          "duty_id",
          input.duty_id || row.id,
          "Attendance already recorded for this duty"
        );
      }
      return passFailure(inserted);
    }

    const fresh = await loadFreshAttendance(String(row.id), ctx, inserted.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    await recomputePayoutFor(fresh.data, ctx);
    return finalizeWithAudit(
      await fireAudit(ctx, { entity_id: String(row.id), action: "create", after: fresh.data }),
      fresh.data
    );
  },

  async update(
    id: string,
    rawInput: unknown,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<AttendanceApiRow>> {
    const existing = await loadAttendance(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Attendance not found", existing.code, existing.details);
    }

    const parsed = parseInput(attendanceSchema, { ...(rawInput as object), id });
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as AttendanceInput;

    const existingRow = toAttendanceRow(existing.data);
    const merged: AttendancePersistInput = {
      ...input,
      check_in_at:
        input.check_in_at ||
        (ATTENDANCE_NO_TIME_STATUSES.has(input.status) ? undefined : existingRow.check_in_at || undefined),
      check_out_at:
        input.check_out_at ||
        (ATTENDANCE_NO_TIME_STATUSES.has(input.status) ? undefined : existingRow.check_out_at || undefined),
      duty_id: input.duty_id || existingRow.duty_id || undefined,
      patient_id: input.patient_id || existingRow.patient_id || undefined,
      shift_type: input.shift_type || existingRow.shift_type || undefined,
      notes: input.notes ?? existingRow.notes ?? ""
    };

    const anchor = ensureAttendanceHasAnchor(merged);
    if (!anchor.success) {
      return failure(anchor.error || "Anchor missing", anchor.code, anchor.details);
    }

    // Duplicate check only when the natural-key changed.
    const dutyChanged = (merged.duty_id || "") !== (existingRow.duty_id || "");
    const employeeChanged = merged.employee_id !== existingRow.employee_id;
    const dateChanged =
      attendanceDateKey(merged.check_in_at) !== attendanceDateKey(existingRow.check_in_at);
    if (dutyChanged || employeeChanged || dateChanged) {
      const dup = await checkDuplicate(merged, id, ctx);
      if (!dup.success) return passFailure(dup);
    }

    const patch = buildAttendancePatch(existingRow, merged, ctx.actor.email);
    const updated = await attendanceRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) {
      if (inferUniqueViolation(updated.error)) {
        return duplicateFailure(
          "duty_id",
          merged.duty_id || id,
          "Attendance already recorded for this duty"
        );
      }
      return passFailure(updated);
    }

    const fresh = await loadFreshAttendance(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    await recomputePayoutFor(fresh.data, ctx);
    // The old row might have lived in a different payout period — recompute
    // both so neither month is left with stale hours.
    if (existing.data.check_in_at) {
      const prevPeriod = attendancePayoutPeriod(String(existing.data.check_in_at), null);
      const newPeriod = attendancePayoutPeriod(
        (fresh.data.check_in_at as string | null) || undefined,
        null
      );
      if (prevPeriod && prevPeriod !== newPeriod) {
        await payoutRepository.recomputeRpc(
          String(existing.data.employee_id || ""),
          prevPeriod,
          dbAccess(ctx)
        );
      }
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
   * Convenience wrapper for the "Mark attendance" UI: takes the same payload as
   * `create`, but upserts when a row for the same duty (or employee+date)
   * already exists. Either way, payout is recomputed and a fresh row is
   * returned for the frontend to refetch from.
   */
  async mark(
    rawInput: unknown,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<AttendanceApiRow>> {
    const parsed = parseInput(attendanceSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as AttendanceInput;

    const anchor = ensureAttendanceHasAnchor(input as AttendancePersistInput);
    if (!anchor.success) {
      return failure(anchor.error || "Anchor missing", anchor.code, anchor.details);
    }

    const access = dbAccess(ctx);
    let existingId: string | undefined;
    if (input.duty_id) {
      const lookup = await attendanceRepository.findByDutyId(input.duty_id, access);
      if (!lookup.success) return passFailure(lookup);
      if (lookup.data) existingId = String(lookup.data.id);
    }
    if (!existingId) {
      const dateKey = attendanceDateKey(input.check_in_at);
      const candidates = await attendanceRepository.findByEmployeeAndDate(
        input.employee_id,
        dateKey,
        access
      );
      if (!candidates.success) return passFailure(candidates);
      const conflict = findAttendanceDuplicate(
        (candidates.data || []).map(toAttendanceRow),
        input.employee_id,
        undefined,
        dateKey
      );
      if (conflict) existingId = conflict.id;
    }

    if (existingId) return attendanceService.update(existingId, rawInput, ctx);
    return attendanceService.create(rawInput, ctx);
  },

  /** Quick toggles surfaced by the legacy UI ("Mark Present", "Mark Absent"). */
  markPresent(
    rawInput: unknown,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<AttendanceApiRow>> {
    return attendanceService.mark(
      { ...(rawInput as object), status: "PRESENT" },
      ctx
    );
  },

  markAbsent(
    rawInput: unknown,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<AttendanceApiRow>> {
    return attendanceService.mark(
      { ...(rawInput as object), status: "ABSENT", check_in_at: undefined, check_out_at: undefined },
      ctx
    );
  },

  async remove(id: string, ctx: AttendanceServiceContext): Promise<ApiResult<{ id: string }>> {
    const existing = await loadAttendance(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Attendance not found", existing.code, existing.details);
    }
    const removed = await attendanceRepository.remove(id, dbAccess(ctx));
    if (!removed.success) return passFailure(removed);

    await recomputePayoutFor(existing.data, ctx);
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "delete",
        before: existing.data,
        stamp: "Attendance removed"
      }),
      { id }
    );
  },

  /**
   * Diagnostic: duties without attendance.
   *
   * The repository returns the duty rows + a set of duty IDs already attended;
   * the business layer decides which to flag. Used by the dashboard refetch
   * loop so users see what they still need to mark.
   */
  async listMissingForEmployee(
    employeeId: string,
    fromISO: string,
    toISO: string,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<JsonRow[]>> {
    const access = dbAccess(ctx);
    const [duties, attendance] = await Promise.all([
      dutyRepository.list(
        { employeeId, from: fromISO, to: toISO, limit: 500, offset: 0 },
        access
      ),
      attendanceRepository.listAttendedDutyIds(employeeId, access)
    ]);
    if (!duties.success) return passFailure(duties);
    if (!attendance.success) return passFailure(attendance);
    const attendedSet = new Set(
      (attendance.data || [])
        .map((r) => (r.duty_id as string | null) || "")
        .filter(Boolean)
    );
    const missing = (duties.data?.rows || []).filter((d) => {
      const status = String(d.status || "").toUpperCase();
      if (status === "CANCELLED" || status === "NO_SHOW") return false;
      return !attendedSet.has(String(d.id));
    });
    return success(missing);
  },

  /** Compute hours for a row without persisting (UI helper). */
  hoursForRow(row: JsonRow): number {
    return hoursBetween(
      (row.check_in_at as string | null) || null,
      (row.check_out_at as string | null) || null
    );
  }
};

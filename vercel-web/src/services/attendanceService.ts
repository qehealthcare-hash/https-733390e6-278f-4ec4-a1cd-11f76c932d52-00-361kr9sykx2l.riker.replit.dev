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
  attendanceDayMarkSchema,
  type AttendanceInput,
  type AttendanceListQuery,
  type AttendanceDayMarkInput,
  type AttendanceStatus
} from "@/validation/attendanceValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  ATTENDANCE_NO_TIME_STATUSES,
  attendanceDateKey,
  attendancePayoutPeriod,
  attendanceRowWorkDate,
  selectMissingAttendance,
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
import { employeeRepository } from "@/database/employeeRepository";
import { patientRepository } from "@/database/patientRepository";
import { payoutRepository } from "@/database/payoutRepository";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
import { dutyService } from "@/services/dutyService";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import type { JsonRow } from "@/database/types";
import { crmTodayIso, crmDayStartIso, crmDayEndIso, crmDateRangeInclusive, crmDateKeyFromTimestamp } from "@/utils/crmToday";
import {
  indexAttendanceForBoard,
  matchAttendanceForSlot
} from "@/services/attendanceBoardHelpers";
import { isOpenEndedEndAt } from "@/business/dutyRules";
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
    notes: String(row.notes ?? row.remarks ?? "") || null,
    work_date: (row.work_date as string | null) ?? null
  };
}

async function checkDuplicate(
  input: AttendancePersistInput,
  excludeId: string | undefined,
  ctx: AttendanceServiceContext
): Promise<ApiResult<null>> {
  const access = dbAccess(ctx);

  if (input.duty_id) {
    const existing = await attendanceRepository.findByDutyAndEmployee(
      input.duty_id,
      input.employee_id,
      access
    );
    if (!existing.success) return passFailure<null>(existing);
    if (existing.data && String(existing.data.id) !== excludeId) {
      return duplicateFailure(
        "duty_employee",
        `${input.duty_id}@${input.employee_id}`,
        "Attendance already recorded for this duty and employee"
      );
    }
    return success(null);
  }

  const dateKey = attendanceDateKey(input.check_in_at, input.work_date);
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
    dutyStart,
    (row.work_date as string | null) || undefined
  );
  if (!period) return;
  await payoutRepository.recomputeRpc(employeeId, period, dbAccess(ctx));
}

function inferUniqueViolation(error: string | undefined): boolean {
  const msg = String(error || "").toLowerCase();
  return (
    msg.includes("uq_hh_attendance_per_duty") ||
    msg.includes("uq_hh_attendance_duty_employee") ||
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
      work_date: input.work_date || (existing.data.work_date as string | undefined),
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
      attendanceDateKey(merged.check_in_at, merged.work_date) !==
      attendanceDateKey(existingRow.check_in_at, existingRow.work_date as string | undefined);
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
    const prevPeriod = attendancePayoutPeriod(
      String(existing.data.check_in_at || ""),
      null,
      existing.data.work_date as string | undefined
    );
    const newPeriod = attendancePayoutPeriod(
      (fresh.data.check_in_at as string | null) || undefined,
      null,
      fresh.data.work_date as string | undefined
    );
    if (prevPeriod && newPeriod && prevPeriod !== newPeriod) {
      await payoutRepository.recomputeRpc(
        String(existing.data.employee_id || ""),
        prevPeriod,
        dbAccess(ctx)
      );
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
      const lookup = await attendanceRepository.findByDutyAndEmployee(
        input.duty_id,
        input.employee_id,
        access
      );
      if (!lookup.success) return passFailure(lookup);
      if (lookup.data) existingId = String(lookup.data.id);
    }
    if (!existingId) {
      const dateKey = attendanceDateKey(input.check_in_at, input.work_date);
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

    const periods = new Set<string>();
    const dutyId = String(existing.data.duty_id || "");
    let dutyStart: string | undefined;
    if (dutyId) {
      const duty = await dutyRepository.findById(dutyId, dbAccess(ctx));
      if (duty.success && duty.data) dutyStart = String(duty.data.start_at || "");
    }
    const p = attendancePayoutPeriod(
      (existing.data.check_in_at as string | null) || undefined,
      dutyStart,
      (existing.data.work_date as string | null) || undefined
    );
    if (p) periods.add(p);
    const prevCheckIn = String(existing.data.check_in_at || "");
    if (prevCheckIn) {
      const prevP = attendancePayoutPeriod(prevCheckIn, dutyStart, existing.data.work_date as string);
      if (prevP) periods.add(prevP);
    }
    const employeeId = String(existing.data.employee_id || "");
    await Promise.all(
      Array.from(periods).map((period) =>
        employeeId
          ? payoutRepository.recomputeRpc(employeeId, period, dbAccess(ctx))
          : Promise.resolve()
      )
    );
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
        .filter((r) => String(r.employee_id || "") === employeeId)
        .map((r) => (r.duty_id as string | null) || "")
        .filter(Boolean)
    );
    const missing = selectMissingAttendance(
      (duties.data?.rows || []).map((d) => ({
        id: String(d.id),
        employee_id: d.employee_id as string | null,
        patient_id: d.patient_id as string | null,
        start_at: d.start_at as string | null,
        end_at: d.end_at as string | null,
        status: d.status as string | null
      })),
      attendedSet
    );
    return success(missing as unknown as JsonRow[]);
  },

  /** Compute hours for a row without persisting (UI helper). */
  hoursForRow(row: JsonRow): number {
    return hoursBetween(
      (row.check_in_at as string | null) || null,
      (row.check_out_at as string | null) || null
    );
  },

  /**
   * "All staff attendance" board for a given calendar day.
   *
   * Composes the duty calendar (every duty whose [start_at, end_at] interval
   * touches `date`) with materialized diary entries (per-day reassigned
   * partners) and the attendance rows that already exist for that day.
   *
   * Returns one row per (duty × partner-on-that-day) plus any standalone
   * attendance (LEAVE / HOLIDAY / ABSENT marked outside of a duty) so the
   * supervisor sees the full day in one screen.
   */
  async dayBoard(
    rawDate: string | undefined,
    filters: { employee_id?: string; patient_id?: string } | undefined,
    ctx: AttendanceServiceContext
  ): Promise<
    ApiResult<{
      date: string;
      rows: Array<{
        key: string;
        duty_id: string | null;
        duty_status: string | null;
        patient_id: string | null;
        patient_name: string;
        employee_id: string;
        employee_name: string;
        shift_type: string | null;
        start_at: string | null;
        end_at: string | null;
        is_extra_partner: boolean;
        attendance_id: string | null;
        attendance_status: string | null;
        check_in_at: string | null;
        check_out_at: string | null;
        hours: number;
        notes: string;
        derived_status:
          | "PRESENT"
          | "ABSENT"
          | "LATE"
          | "HALF_DAY"
          | "LEAVE"
          | "HOLIDAY"
          | "COMPLETED"
          | "IN_PROGRESS"
          | "SCHEDULED"
          | "UNMARKED";
      }>;
      summary: {
        total: number;
        scheduled: number;
        present: number;
        absent: number;
        late: number;
        half_day: number;
        leave: number;
        holiday: number;
        completed: number;
        in_progress: number;
        unmarked: number;
      };
    }>
  > {
    const access = dbAccess(ctx);
    const date = (rawDate || "").trim() || crmTodayIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return failure("date must be YYYY-MM-DD", ErrorCodes.badRequest);
    }
    const dayStart = crmDayStartIso(date);
    const dayEnd = crmDayEndIso(date);
    const empFilter = (filters?.employee_id || "").trim();
    const patientFilter = (filters?.patient_id || "").trim();

    // 1. All duties whose calendar window includes `date`. dutyRepository.list
    //    already implements interval overlap (start_at <= to AND end_at >= from)
    //    and matches `extra_partners` for the employee filter.
    const dutiesRes = await dutyRepository.list(
      {
        from: dayStart,
        to: dayEnd,
        employeeId: empFilter || undefined,
        patientId: patientFilter || undefined,
        limit: 500,
        offset: 0
      },
      access
    );
    if (!dutiesRes.success) return passFailure(dutiesRes);
    const duties = (dutiesRes.data?.rows || []).filter((d) => {
      const status = String(d.status || "").toUpperCase();
      return status !== "CANCELLED" && status !== "NO_SHOW";
    });

    // 2. Per-day diary so we pick up reassignments / extra partners that
    //    actually worked that date (not just the duty's static partner list).
    const diaryByDuty: Record<
      string,
      Array<{ employee_id: string; partner: string; manual: boolean }>
    > = {};
    if (duties.length) {
      const batch = await dutyDiaryService.listDaysBatch(
        duties.map((d) => String(d.id)),
        ctx
      );
      if (batch.success) {
        for (const [dutyId, result] of Object.entries(batch.data || {})) {
          const entriesForDay = (result.entries || []).filter((e) => e.date === date);
          if (entriesForDay.length) {
            diaryByDuty[dutyId] = entriesForDay.map((e) => ({
              employee_id: e.employee_id,
              partner: e.partner || "",
              manual: !!e.manual
            }));
          }
        }
      }
    }

    // 3. Collect every (duty, partner) slot and the unique employee/patient
    //    ids we need to label.
    type Slot = {
      duty: JsonRow;
      employee_id: string;
      is_extra: boolean;
    };
    const slots: Slot[] = [];
    const employeeIds = new Set<string>();
    const patientIds = new Set<string>();
    for (const duty of duties) {
      const primary = String(duty.employee_id || "");
      if (primary) employeeIds.add(primary);
      const pat = String(duty.patient_id || "");
      if (pat) patientIds.add(pat);

      const diary = diaryByDuty[String(duty.id)] || [];
      if (diary.length) {
        for (const d of diary) {
          if (empFilter && d.employee_id !== empFilter) continue;
          employeeIds.add(d.employee_id);
          slots.push({ duty, employee_id: d.employee_id, is_extra: d.employee_id !== primary });
        }
      } else if (primary) {
        if (empFilter && primary !== empFilter) continue;
        slots.push({ duty, employee_id: primary, is_extra: false });
      }
    }

    // 4. Attendance for that day — fetch in one shot by date window, then
    //    bucket by duty_id and by (employee_id, no duty).
    const attRes = await attendanceRepository.list(
      {
        from: dayStart,
        to: dayEnd,
        limit: 500,
        offset: 0
      },
      access
    );
    if (!attRes.success) return passFailure(attRes);
    // ABSENT / LEAVE / HOLIDAY rows have no check_in_at → fall through the
    // date-window filter above. Fetch them separately keyed by employee +
    // updated_at on the date (best-effort; for our employee set).
    const employeeIdList = Array.from(employeeIds);
    const offDuty: JsonRow[] = [];
    if (employeeIdList.length) {
      // The repo doesn't have a multi-status no-time fetch; we'll do one
      // findByEmployeeAndDate per relevant employee. List is bounded by
      // the day's duty staff, so this is small even for busy days.
      const probes = await Promise.all(
        employeeIdList.map((empId) =>
          attendanceRepository.findByEmployeeAndDate(empId, date, access).then((r) =>
            r.success ? r.data || [] : []
          )
        )
      );
      for (const arr of probes) offDuty.push(...arr);
    }
    const allAttendance: JsonRow[] = [...(attRes.data?.rows || []), ...offDuty];
    const attMaps = indexAttendanceForBoard(allAttendance);

    // 5. Lookup tables for names.
    const empMap = new Map<string, string>();
    const patMap = new Map<string, string>();
    if (employeeIdList.length) {
      const loaded = await Promise.all(
        employeeIdList.map((id) => employeeRepository.findById(id, access))
      );
      loaded.forEach((r, idx) => {
        const empId = employeeIdList[idx];
        if (r.success && r.data) {
          const d = r.data as Record<string, unknown>;
          const fromLookup = String(d.full_name || d.name || "").trim();
          const fromParts = [d.fn, d.mn, d.ln]
            .map((p) => String(p || "").trim())
            .filter(Boolean)
            .join(" ")
            .trim();
          empMap.set(empId, fromLookup || fromParts || empId);
        } else {
          empMap.set(empId, empId);
        }
      });
    }
    const patientIdList = Array.from(patientIds);
    if (patientIdList.length) {
      const loaded = await Promise.all(
        patientIdList.map((id) => patientRepository.findById(id, access))
      );
      loaded.forEach((r, idx) => {
        const pid = patientIdList[idx];
        if (r.success && r.data) {
          const d = r.data as Record<string, unknown>;
          patMap.set(pid, String(d.name || d.full_name || pid));
        } else {
          patMap.set(pid, pid);
        }
      });
    }

    // 6. Compose rows + summary.
    function deriveStatus(att: JsonRow | undefined, duty: JsonRow | undefined): string {
      if (att) {
        const s = String(att.status || "").toUpperCase();
        if (s === "PRESENT") {
          if (duty) {
            const dutyStatus = String(duty.status || "").toUpperCase();
            if (dutyStatus === "COMPLETED") return "COMPLETED";
            if (att.check_out_at) return "COMPLETED";
            if (att.check_in_at) return "IN_PROGRESS";
          }
          return "PRESENT";
        }
        return s || "UNMARKED";
      }
      if (duty) return "SCHEDULED";
      return "UNMARKED";
    }

    const usedAttendanceIds = new Set<string>();
    const rows: Array<{
      key: string;
      duty_id: string | null;
      duty_status: string | null;
      patient_id: string | null;
      patient_name: string;
      employee_id: string;
      employee_name: string;
      shift_type: string | null;
      start_at: string | null;
      end_at: string | null;
      is_extra_partner: boolean;
      attendance_id: string | null;
      attendance_status: string | null;
      check_in_at: string | null;
      check_out_at: string | null;
      hours: number;
      notes: string;
      derived_status:
        | "PRESENT"
        | "ABSENT"
        | "LATE"
        | "HALF_DAY"
        | "LEAVE"
        | "HOLIDAY"
        | "COMPLETED"
        | "IN_PROGRESS"
        | "SCHEDULED"
        | "UNMARKED";
    }> = [];

    for (const slot of slots) {
      const dutyId = String(slot.duty.id);
      const att = matchAttendanceForSlot(dutyId, slot.employee_id, date, attMaps);
      if (att) usedAttendanceIds.add(String(att.id));
      const derived = deriveStatus(att, slot.duty) as
        | "PRESENT"
        | "ABSENT"
        | "LATE"
        | "HALF_DAY"
        | "LEAVE"
        | "HOLIDAY"
        | "COMPLETED"
        | "IN_PROGRESS"
        | "SCHEDULED"
        | "UNMARKED";
      rows.push({
        key: `${dutyId}|${slot.employee_id}`,
        duty_id: dutyId,
        duty_status: String(slot.duty.status || ""),
        patient_id: String(slot.duty.patient_id || "") || null,
        patient_name: patMap.get(String(slot.duty.patient_id || "")) || "—",
        employee_id: slot.employee_id,
        employee_name: empMap.get(slot.employee_id) || slot.employee_id,
        shift_type: (slot.duty.shift_type as string | null) || null,
        start_at: (slot.duty.start_at as string | null) || null,
        end_at: (slot.duty.end_at as string | null) || null,
        is_extra_partner: slot.is_extra,
        attendance_id: att ? String(att.id) : null,
        attendance_status: att ? String(att.status || "") : null,
        check_in_at: att ? ((att.check_in_at as string | null) || null) : null,
        check_out_at: att ? ((att.check_out_at as string | null) || null) : null,
        hours: att ? Number(att.hours ?? 0) || 0 : 0,
        notes: att ? String(att.remarks ?? att.notes ?? "") : "",
        derived_status: derived
      });
    }

    // 7. Standalone attendance rows (no duty for this day) — LEAVE / HOLIDAY
    //    or one-off ABSENT marks. Surface them so the supervisor still sees
    //    them in the board.
    for (const att of allAttendance) {
      const aid = String(att.id);
      if (usedAttendanceIds.has(aid)) continue;
      const emp = String(att.employee_id || "");
      if (!emp) continue;
      if (empFilter && emp !== empFilter) continue;
      const patId = String(att.patient_id || "") || null;
      if (patientFilter && patId !== patientFilter) continue;
      // Ensure label maps cover orphans too.
      if (!empMap.has(emp)) {
        const lookup = await employeeRepository.findById(emp, access);
        if (lookup.success && lookup.data) {
          const d = lookup.data as Record<string, unknown>;
          const composed =
            String(d.full_name || d.name || "").trim() ||
            [d.fn, d.mn, d.ln]
              .map((p) => String(p || "").trim())
              .filter(Boolean)
              .join(" ")
              .trim();
          empMap.set(emp, composed || emp);
        } else {
          empMap.set(emp, emp);
        }
      }
      const derived = deriveStatus(att, undefined) as
        | "PRESENT"
        | "ABSENT"
        | "LATE"
        | "HALF_DAY"
        | "LEAVE"
        | "HOLIDAY"
        | "COMPLETED"
        | "IN_PROGRESS"
        | "SCHEDULED"
        | "UNMARKED";
      rows.push({
        key: `_att_${aid}`,
        duty_id: (att.duty_id as string | null) || null,
        duty_status: null,
        patient_id: patId,
        patient_name: patId ? patMap.get(patId) || patId : "—",
        employee_id: emp,
        employee_name: empMap.get(emp) || emp,
        shift_type: null,
        start_at: null,
        end_at: null,
        is_extra_partner: false,
        attendance_id: aid,
        attendance_status: String(att.status || ""),
        check_in_at: (att.check_in_at as string | null) || null,
        check_out_at: (att.check_out_at as string | null) || null,
        hours: Number(att.hours ?? 0) || 0,
        notes: String(att.remarks ?? att.notes ?? ""),
        derived_status: derived
      });
    }

    // Stable sort: scheduled-but-unmarked at the top, then by employee name.
    rows.sort((a, b) => {
      const aRank = a.derived_status === "SCHEDULED" ? 0 : 1;
      const bRank = b.derived_status === "SCHEDULED" ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      return a.employee_name.localeCompare(b.employee_name);
    });

    const summary = {
      total: rows.length,
      scheduled: 0,
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
      leave: 0,
      holiday: 0,
      completed: 0,
      in_progress: 0,
      unmarked: 0
    };
    for (const r of rows) {
      switch (r.derived_status) {
        case "SCHEDULED":
          summary.scheduled += 1;
          summary.unmarked += 1;
          break;
        case "PRESENT":
          summary.present += 1;
          break;
        case "ABSENT":
          summary.absent += 1;
          break;
        case "LATE":
          summary.late += 1;
          break;
        case "HALF_DAY":
          summary.half_day += 1;
          break;
        case "LEAVE":
          summary.leave += 1;
          break;
        case "HOLIDAY":
          summary.holiday += 1;
          break;
        case "COMPLETED":
          summary.completed += 1;
          break;
        case "IN_PROGRESS":
          summary.in_progress += 1;
          break;
        default:
          summary.unmarked += 1;
      }
    }
    return success({ date, rows, summary });
  },

  /**
   * Range board — same merging logic as `dayBoard` but for an arbitrary
   * [from, to] window. Yields one row per (calendar-day × duty × partner)
   * so the supervisor / payroll can see every worked or scheduled day even
   * if no attendance row was ever recorded for it.
   *
   * Used by `/attendance` log and the salary-reference PDF.
   */
  async rangeBoard(
    rawFrom: string | undefined,
    rawTo: string | undefined,
    filters: { employee_id?: string; patient_id?: string; status?: string } | undefined,
    ctx: AttendanceServiceContext
  ): Promise<
    ApiResult<{
      from: string;
      to: string;
      rows: Array<{
        key: string;
        date: string;
        duty_id: string | null;
        duty_status: string | null;
        patient_id: string | null;
        patient_name: string;
        employee_id: string;
        employee_name: string;
        shift_type: string | null;
        is_extra_partner: boolean;
        attendance_id: string | null;
        attendance_status: string | null;
        check_in_at: string | null;
        check_out_at: string | null;
        hours: number;
        charge: number;
        payout: number;
        notes: string;
        derived_status:
          | "PRESENT"
          | "ABSENT"
          | "LATE"
          | "HALF_DAY"
          | "LEAVE"
          | "HOLIDAY"
          | "COMPLETED"
          | "IN_PROGRESS"
          | "SCHEDULED"
          | "UNMARKED";
      }>;
      summary: {
        total: number;
        scheduled: number;
        present: number;
        absent: number;
        late: number;
        half_day: number;
        leave: number;
        holiday: number;
        completed: number;
        in_progress: number;
        unmarked: number;
        total_hours: number;
        total_charge: number;
        total_payout: number;
      };
    }>
  > {
    const access = dbAccess(ctx);
    const today = crmTodayIso();
    const to = (rawTo || "").trim() || today;
    const from = (rawFrom || "").trim() || to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return failure("from / to must be YYYY-MM-DD", ErrorCodes.badRequest);
    }
    if (from > to) {
      return failure("from must be <= to", ErrorCodes.badRequest);
    }
    const fromStart = crmDayStartIso(from);
    const toEnd = crmDayEndIso(to);
    const empFilter = (filters?.employee_id || "").trim();
    const patientFilter = (filters?.patient_id || "").trim();
    const statusFilter = (filters?.status || "").trim().toUpperCase();

    // 1. Duties overlapping the window.
    const dutiesRes = await dutyRepository.list(
      {
        from: fromStart,
        to: toEnd,
        employeeId: empFilter || undefined,
        patientId: patientFilter || undefined,
        limit: 500,
        offset: 0
      },
      access
    );
    if (!dutiesRes.success) return passFailure(dutiesRes);
    const duties = (dutiesRes.data?.rows || []).filter((d) => {
      const status = String(d.status || "").toUpperCase();
      return status !== "CANCELLED" && status !== "NO_SHOW";
    });

    // 2. Diary entries for these duties → one row per worked day x partner.
    type Slot = {
      date: string;
      duty: JsonRow;
      employee_id: string;
      is_extra: boolean;
      charge: number;
      payout: number;
    };
    const slots: Slot[] = [];
    const employeeIds = new Set<string>();
    const patientIds = new Set<string>();
    let diaryBatch: Record<string, { entries: Array<{ date: string; employee_id: string; charge?: number; payout?: number }> }> = {};
    if (duties.length) {
      const batch = await dutyDiaryService.listDaysBatch(
        duties.map((d) => String(d.id)),
        ctx
      );
      if (!batch.success) return passFailure(batch);
      diaryBatch = batch.data || {};
      const byId = new Map(duties.map((d) => [String(d.id), d]));
      const slotKeys = new Set<string>();
      for (const [dutyId, result] of Object.entries(diaryBatch)) {
        const duty = byId.get(dutyId);
        if (!duty) continue;
        const primary = String(duty.employee_id || "");
        const pat = String(duty.patient_id || "");
        if (pat) patientIds.add(pat);
        for (const entry of result.entries || []) {
          if (entry.date < from || entry.date > to) continue;
          if (empFilter && entry.employee_id !== empFilter) continue;
          employeeIds.add(entry.employee_id);
          const sk = `${entry.date}|${dutyId}|${entry.employee_id}`;
          if (slotKeys.has(sk)) continue;
          slotKeys.add(sk);
          slots.push({
            date: entry.date,
            duty,
            employee_id: entry.employee_id,
            is_extra: entry.employee_id !== primary,
            charge: Number(entry.charge ?? 0),
            payout: Number(entry.payout ?? 0)
          });
        }
      }
      for (const duty of duties) {
        const dutyId = String(duty.id);
        const entriesInRange = (diaryBatch[dutyId]?.entries || []).filter(
          (e) => e.date >= from && e.date <= to
        );
        if (entriesInRange.length) continue;
        const primary = String(duty.employee_id || "");
        if (!primary || (empFilter && primary !== empFilter)) continue;
        const start = crmDateKeyFromTimestamp(String(duty.start_at || ""));
        const rawEnd = String(duty.end_at || "");
        const end = isOpenEndedEndAt(rawEnd) ? today : crmDateKeyFromTimestamp(rawEnd);
        for (const d of crmDateRangeInclusive(from, to)) {
          if (d < start || d > end) continue;
          const sk = `${d}|${dutyId}|${primary}`;
          if (slotKeys.has(sk)) continue;
          slotKeys.add(sk);
          employeeIds.add(primary);
          const pat = String(duty.patient_id || "");
          if (pat) patientIds.add(pat);
          slots.push({
            date: d,
            duty,
            employee_id: primary,
            is_extra: false,
            charge: 0,
            payout: 0
          });
        }
      }
    }

    // 3. All attendance rows for those employees that touch the window,
    //    including no-time statuses (ABSENT/LEAVE/HOLIDAY).
    const empIdList = Array.from(employeeIds);
    if (empFilter) empIdList.push(empFilter);
    const empIdSetForAtt = Array.from(new Set(empIdList.filter(Boolean)));
    const attRes = await attendanceRepository.listInRange(
      empIdSetForAtt,
      fromStart,
      toEnd,
      access
    );
    if (!attRes.success) return passFailure(attRes);
    const attRows = attRes.data || [];

    const attMaps = indexAttendanceForBoard(attRows);

    // 4. Lookup tables.
    const empMap = new Map<string, string>();
    const patMap = new Map<string, string>();
    for (const row of attRows) {
      const emp = String(row.employee_id || "");
      if (emp) employeeIds.add(emp);
      const pat = String(row.patient_id || "");
      if (pat) patientIds.add(pat);
    }
    const fullEmpList = Array.from(employeeIds);
    if (fullEmpList.length) {
      const loaded = await Promise.all(
        fullEmpList.map((id) => employeeRepository.findById(id, access))
      );
      loaded.forEach((r, idx) => {
        const empId = fullEmpList[idx];
        if (r.success && r.data) {
          const d = r.data as Record<string, unknown>;
          const fromLookup = String(d.full_name || d.name || "").trim();
          const fromParts = [d.fn, d.mn, d.ln]
            .map((p) => String(p || "").trim())
            .filter(Boolean)
            .join(" ")
            .trim();
          empMap.set(empId, fromLookup || fromParts || empId);
        } else {
          empMap.set(empId, empId);
        }
      });
    }
    const fullPatList = Array.from(patientIds);
    if (fullPatList.length) {
      const loaded = await Promise.all(
        fullPatList.map((id) => patientRepository.findById(id, access))
      );
      loaded.forEach((r, idx) => {
        const pid = fullPatList[idx];
        if (r.success && r.data) {
          const d = r.data as Record<string, unknown>;
          patMap.set(pid, String(d.name || d.full_name || pid));
        } else {
          patMap.set(pid, pid);
        }
      });
    }

    function deriveStatus(att: JsonRow | undefined, duty: JsonRow | undefined): string {
      if (att) {
        const s = String(att.status || "").toUpperCase();
        if (s === "PRESENT") {
          if (duty) {
            const dutyStatus = String(duty.status || "").toUpperCase();
            if (dutyStatus === "COMPLETED") return "COMPLETED";
            if (att.check_out_at) return "COMPLETED";
            if (att.check_in_at) return "IN_PROGRESS";
          }
          return "PRESENT";
        }
        return s || "UNMARKED";
      }
      if (duty) return "SCHEDULED";
      return "UNMARKED";
    }

    type Row = {
      key: string;
      date: string;
      duty_id: string | null;
      duty_status: string | null;
      patient_id: string | null;
      patient_name: string;
      employee_id: string;
      employee_name: string;
      shift_type: string | null;
      is_extra_partner: boolean;
      attendance_id: string | null;
      attendance_status: string | null;
      check_in_at: string | null;
      check_out_at: string | null;
      hours: number;
      charge: number;
      payout: number;
      notes: string;
      derived_status:
        | "PRESENT"
        | "ABSENT"
        | "LATE"
        | "HALF_DAY"
        | "LEAVE"
        | "HOLIDAY"
        | "COMPLETED"
        | "IN_PROGRESS"
        | "SCHEDULED"
        | "UNMARKED";
    };

    const rows: Row[] = [];
    const usedAttIds = new Set<string>();

    for (const slot of slots) {
      const did = String(slot.duty.id);
      const matchingAtt = matchAttendanceForSlot(did, slot.employee_id, slot.date, attMaps);
      if (matchingAtt) usedAttIds.add(String(matchingAtt.id));
      const derived = deriveStatus(matchingAtt, slot.duty) as Row["derived_status"];
      rows.push({
        key: `${slot.date}|${did}|${slot.employee_id}`,
        date: slot.date,
        duty_id: did,
        duty_status: String(slot.duty.status || ""),
        patient_id: String(slot.duty.patient_id || "") || null,
        patient_name: patMap.get(String(slot.duty.patient_id || "")) || "—",
        employee_id: slot.employee_id,
        employee_name: empMap.get(slot.employee_id) || slot.employee_id,
        shift_type: (slot.duty.shift_type as string | null) || null,
        is_extra_partner: slot.is_extra,
        attendance_id: matchingAtt ? String(matchingAtt.id) : null,
        attendance_status: matchingAtt ? String(matchingAtt.status || "") : null,
        check_in_at: matchingAtt ? ((matchingAtt.check_in_at as string | null) || null) : null,
        check_out_at: matchingAtt ? ((matchingAtt.check_out_at as string | null) || null) : null,
        hours: matchingAtt ? Number(matchingAtt.hours ?? 0) || 0 : 0,
        charge: slot.charge,
        payout: slot.payout,
        notes: matchingAtt ? String(matchingAtt.remarks ?? matchingAtt.notes ?? "") : "",
        derived_status: derived
      });
    }

    // Standalone attendance (LEAVE / HOLIDAY / one-off ABSENT without a duty).
    for (const att of attRows) {
      const aid = String(att.id);
      if (usedAttIds.has(aid)) continue;
      const emp = String(att.employee_id || "");
      if (!emp) continue;
      if (empFilter && emp !== empFilter) continue;
      const pat = String(att.patient_id || "") || null;
      if (patientFilter && pat !== patientFilter) continue;
      const date = attendanceRowWorkDate(att);
      if (!date || date < from || date > to) continue;
      if (!empMap.has(emp)) {
        const lookup = await employeeRepository.findById(emp, access);
        if (lookup.success && lookup.data) {
          const d = lookup.data as Record<string, unknown>;
          const composed =
            String(d.full_name || d.name || "").trim() ||
            [d.fn, d.mn, d.ln]
              .map((p) => String(p || "").trim())
              .filter(Boolean)
              .join(" ")
              .trim();
          empMap.set(emp, composed || emp);
        } else {
          empMap.set(emp, emp);
        }
      }
      const derived = deriveStatus(att, undefined) as Row["derived_status"];
      rows.push({
        key: `_att_${aid}`,
        date,
        duty_id: (att.duty_id as string | null) || null,
        duty_status: null,
        patient_id: pat,
        patient_name: pat ? patMap.get(pat) || pat : "—",
        employee_id: emp,
        employee_name: empMap.get(emp) || emp,
        shift_type: (att.shift_type as string | null) || null,
        is_extra_partner: false,
        attendance_id: aid,
        attendance_status: String(att.status || ""),
        check_in_at: (att.check_in_at as string | null) || null,
        check_out_at: (att.check_out_at as string | null) || null,
        hours: Number(att.hours ?? 0) || 0,
        charge: 0,
        payout: 0,
        notes: String(att.remarks ?? att.notes ?? ""),
        derived_status: derived
      });
    }

    // Optional status filter (post-merge so SCHEDULED is filterable too).
    const filteredRows = statusFilter
      ? rows.filter((r) => r.derived_status === statusFilter || r.attendance_status === statusFilter)
      : rows;

    filteredRows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1; // newest first
      return a.employee_name.localeCompare(b.employee_name);
    });

    const summary = {
      total: filteredRows.length,
      scheduled: 0,
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
      leave: 0,
      holiday: 0,
      completed: 0,
      in_progress: 0,
      unmarked: 0,
      total_hours: 0,
      total_charge: 0,
      total_payout: 0
    };
    for (const r of filteredRows) {
      switch (r.derived_status) {
        case "SCHEDULED":
          summary.scheduled += 1;
          summary.unmarked += 1;
          break;
        case "PRESENT":
          summary.present += 1;
          break;
        case "ABSENT":
          summary.absent += 1;
          break;
        case "LATE":
          summary.late += 1;
          break;
        case "HALF_DAY":
          summary.half_day += 1;
          break;
        case "LEAVE":
          summary.leave += 1;
          break;
        case "HOLIDAY":
          summary.holiday += 1;
          break;
        case "COMPLETED":
          summary.completed += 1;
          break;
        case "IN_PROGRESS":
          summary.in_progress += 1;
          break;
        default:
          summary.unmarked += 1;
      }
      summary.total_hours += Number(r.hours || 0);
      summary.total_charge += Number(r.charge || 0);
      summary.total_payout += Number(r.payout || 0);
    }
    return success({ from, to, rows: filteredRows, summary });
  },

  /**
   * Day-board quick mark. Wraps `mark` but:
   *   - Synthesises check_in_at = `${date}T09:00:00.000Z` when not provided
   *     and the status needs a clock-in.
   *   - When `sync_duty: true` (the default for duty-backed marks) and the
   *     associated duty is still SCHEDULED, also flips the duty to
   *     IN_PROGRESS via `dutyService.checkIn` so the calendar stays in sync.
   */
  async dayMark(
    rawInput: unknown,
    ctx: AttendanceServiceContext
  ): Promise<ApiResult<AttendanceApiRow>> {
    const parsed = parseInput(attendanceDayMarkSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as AttendanceDayMarkInput;
    const date = input.date;
    const status = input.status;
    const noTime = ATTENDANCE_NO_TIME_STATUSES.has(status);
    const payload: Record<string, unknown> = {
      employee_id: input.employee_id,
      status,
      work_date: date,
      duty_id: input.duty_id || undefined,
      patient_id: input.patient_id || undefined,
      shift_type: input.shift_type || undefined,
      notes: input.notes ?? ""
    };
    if (!noTime) {
      payload.check_in_at = input.check_in_at || `${date}T09:00:00.000+05:30`;
      if (input.check_out_at) payload.check_out_at = input.check_out_at;
    }

    const marked = await attendanceService.mark(payload, ctx);
    if (!marked.success) return marked;

    if (input.sync_duty !== false && input.duty_id && status === "PRESENT") {
      // Only advance SCHEDULED → IN_PROGRESS; never re-touch a COMPLETED duty.
      const duty = await dutyRepository.findById(input.duty_id, dbAccess(ctx));
      if (duty.success && duty.data) {
        const dutyStatus = String(duty.data.status || "").toUpperCase();
        if (dutyStatus === "SCHEDULED") {
          // Use the attendance's check-in time so the duty's first
          // check-in audit reflects the operator's intent.
          const checkIn = String(payload.check_in_at || `${date}T09:00:00.000+05:30`);
          await dutyService
            .checkIn(input.duty_id, checkIn, ctx as { actor: ActorLike })
            .catch((err) => {
              console.error("[attendanceService.dayMark] duty check-in sync failed", err);
            });
        }
      }
    }
    return marked;
  }
};

/**
 * Duty-calendar ↔ attendance sync with audit + payout recompute.
 * Lives outside attendanceService to avoid circular imports with dutyService.
 */

import { hoursBetween } from "@/business/attendanceRules";
import { newId } from "@/business/idRules";
import { attendanceRepository } from "@/database/attendanceRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { payoutRepository } from "@/database/payoutRepository";
import type { JsonRow } from "@/database/types";
import { writeMutationAudit } from "@/services/mutationAudit";
import type { ActorLike } from "@/services/attendanceService";
import { attendancePayoutPeriod } from "@/business/attendanceRules";
import { crmDateKeyFromTimestamp } from "@/utils/crmToday";

export interface AttendanceSyncContext {
  actor: ActorLike;
  accessToken?: string;
}

function dbAccess(ctx: AttendanceSyncContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function auditAttendance(
  ctx: AttendanceSyncContext,
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

async function recomputeForRow(
  row: JsonRow,
  ctx: AttendanceSyncContext,
  dutyStart?: string
): Promise<void> {
  const employeeId = String(row.employee_id || "");
  if (!employeeId) return;
  const period = attendancePayoutPeriod(
    (row.check_in_at as string | null) || undefined,
    dutyStart,
    (row.work_date as string | null) || undefined
  );
  if (!period) return;
  await payoutRepository.recomputeRpc(employeeId, period, dbAccess(ctx));
}

export async function syncDutyCheckIn(
  dutyId: string,
  employeeId: string,
  patientId: string,
  checkInAt: string,
  shiftType: string | undefined,
  ctx: AttendanceSyncContext
): Promise<void> {
  const access = dbAccess(ctx);
  const lookup = await attendanceRepository.findByDutyAndEmployee(dutyId, employeeId, access);
  if (!lookup.success) return;
  const workDate = crmDateKeyFromTimestamp(checkInAt);

  if (lookup.data) {
    const before = lookup.data;
    const updated = await attendanceRepository.update(
      String(before.id),
      {
        check_in_at: checkInAt,
        status: "PRESENT",
        work_date: workDate,
        shift_type: shiftType || (before.shift_type as string | null) || null,
        updated_by: ctx.actor.email
      },
      access
    );
    if (updated.success) {
      const fresh = await attendanceRepository.findById(String(before.id), access);
      await auditAttendance(ctx, {
        entity_id: String(before.id),
        action: "update",
        before,
        after: fresh.data ?? updated.data,
        stamp: `Duty ${dutyId} check-in`
      });
      if (fresh.data) await recomputeForRow(fresh.data, ctx);
    }
    return;
  }

  const id = newId.attendance();
  const inserted = await attendanceRepository.insert(
    {
      id,
      duty_id: dutyId,
      employee_id: employeeId,
      patient_id: patientId || null,
      shift_type: shiftType || null,
      work_date: workDate,
      check_in_at: checkInAt,
      status: "PRESENT",
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    },
    access
  );
  if (inserted.success) {
    await auditAttendance(ctx, {
      entity_id: id,
      action: "create",
      after: inserted.data,
      stamp: `Duty ${dutyId} check-in`
    });
    if (inserted.data) await recomputeForRow(inserted.data, ctx);
  }
}

export async function syncDutyCheckOut(
  dutyId: string,
  employeeId: string,
  checkOutAt: string,
  ctx: AttendanceSyncContext
): Promise<void> {
  const access = dbAccess(ctx);
  const lookup = await attendanceRepository.findByDutyAndEmployee(dutyId, employeeId, access);
  if (!lookup.success || !lookup.data) return;
  const before = lookup.data;
  const checkInAt = String(before.check_in_at || "");
  const hours = hoursBetween(checkInAt, checkOutAt);
  const updated = await attendanceRepository.update(
    String(before.id),
    {
      check_out_at: checkOutAt,
      hours,
      status: "PRESENT",
      updated_by: ctx.actor.email
    },
    access
  );
  if (!updated.success) return;
  const fresh = await attendanceRepository.findById(String(before.id), access);
  await auditAttendance(ctx, {
    entity_id: String(before.id),
    action: "update",
    before,
    after: fresh.data ?? updated.data,
    stamp: `Duty ${dutyId} check-out (${hours.toFixed(2)}h)`
  });
  const duty = await dutyRepository.findById(dutyId, access);
  const dutyStart = duty.success && duty.data ? String(duty.data.start_at || "") : undefined;
  if (fresh.data) await recomputeForRow(fresh.data, ctx, dutyStart);
}

export async function syncDutyCancelledAbsent(
  dutyId: string,
  reason: string,
  ctx: AttendanceSyncContext
): Promise<void> {
  const access = dbAccess(ctx);
  const list = await attendanceRepository.list({ dutyId, limit: 50, offset: 0 }, access);
  if (!list.success) return;
  for (const row of list.data?.rows || []) {
    const before = row;
    const updated = await attendanceRepository.update(
      String(before.id),
      {
        status: "ABSENT",
        check_in_at: null,
        check_out_at: null,
        hours: 0,
        remarks: `Duty cancelled: ${reason || "no reason"}`,
        updated_by: ctx.actor.email
      },
      access
    );
    if (updated.success) {
      const fresh = await attendanceRepository.findById(String(before.id), access);
      await auditAttendance(ctx, {
        entity_id: String(before.id),
        action: "update",
        before,
        after: fresh.data ?? updated.data,
        stamp: `Marked ABSENT — parent duty ${dutyId} cancelled`
      });
      if (fresh.data) await recomputeForRow(fresh.data, ctx);
    }
  }
}

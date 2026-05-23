/**
 * Materialize duty windows into per-day `hh_svc_entries` + `hh_payout_charges`
 * (legacy duty diary parity).
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { billingSvcKey, canEditBilling } from "@/business/billingRules";
import {
  buildPayoutChargeRow,
  buildSvcEntryRow,
  collectDutyPartners,
  eachDutyCalendarDay,
  normalizeExtraPartners,
  type DutyPartnerAssignment
} from "@/business/dutyDiaryRules";
import { billingRepository } from "@/database/billingRepository";
import { employeeRepository } from "@/database/employeeRepository";
import { dutyRepository } from "@/database/dutyRepository";
import type { JsonRow } from "@/database/types";
import type { DutyServiceContext } from "@/services/dutyService";
import { failure, passFailure, success } from "@/utils/apiResponse";

function dbAccess(ctx: DutyServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function employeeDisplayName(id: string, ctx: DutyServiceContext): Promise<string> {
  if (!id) return "";
  const row = await employeeRepository.findById(id, dbAccess(ctx));
  if (!row.success || !row.data) return id;
  return String(row.data.full_name || row.data.name || id);
}

export interface MaterializeResult {
  billing_id: string;
  svc_key: string;
  created_svc: number;
  created_payout: number;
  skipped: number;
  days: number;
}

export const dutyDiaryService = {
  async materializeDuty(
    duty: JsonRow,
    ctx: DutyServiceContext,
    opts?: { from?: string; to?: string; dry_run?: boolean }
  ): Promise<ApiResult<MaterializeResult>> {
    const access = dbAccess(ctx);
    const dutyId = String(duty.id);
    const patientId = String(duty.patient_id || "");
    const primaryId = String(duty.employee_id || "");
    const status = String(duty.status || "").toUpperCase();

    if (!patientId || !primaryId) {
      return failure("Duty must have patient_id and employee_id to materialize", ErrorCodes.badRequest);
    }
    if (status === "CANCELLED" || status === "NO_SHOW") {
      return failure("Cannot materialize a cancelled or no-show duty", ErrorCodes.business);
    }

    const active = await billingRepository.findActiveByPatient(patientId, access);
    if (!active.success) return passFailure(active);
    if (!active.data) {
      return failure("No active bill for patient — open billing first", ErrorCodes.business);
    }

    const billingId = String(active.data.id);
    const editGuard = canEditBilling(String(active.data.status || ""));
    if (!editGuard.success) {
      return failure(editGuard.error || "Bill is locked", editGuard.code, editGuard.details);
    }

    const serviceName =
      String(duty.service_name || duty.service_type || "").trim() || "Care Taker Services";
    const svcKey = billingSvcKey(billingId, serviceName);
    const chargePerDay = Number(duty.charge_per_day ?? 0);
    const payoutPerDay = Number(duty.payout_per_day ?? 0);
    const payoutTerm = String(duty.payout_term || "Daily");
    const shiftType = String(duty.shift_type || "DAY");
    const extra = normalizeExtraPartners(duty.extra_partners);
    const partners = collectDutyPartners(
      primaryId,
      chargePerDay,
      payoutPerDay,
      payoutTerm,
      extra
    );

    const allDays = eachDutyCalendarDay(String(duty.start_at), String(duty.end_at));
    const from = opts?.from;
    const to = opts?.to;
    const days = allDays.filter((d) => {
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    let createdSvc = 0;
    let createdPayout = 0;
    let skipped = 0;

    if (opts?.dry_run) {
      return success({
        billing_id: billingId,
        svc_key: svcKey,
        created_svc: 0,
        created_payout: 0,
        skipped: days.length * partners.length,
        days: days.length
      });
    }

    const nameCache = new Map<string, string>();

    for (const isoDate of days) {
      for (const partner of partners) {
        const empId = partner.employee_id;
        let empName = nameCache.get(empId);
        if (!empName) {
          empName = await employeeDisplayName(empId, ctx);
          nameCache.set(empId, empName);
        }

        const rowInput = {
          dutyId,
          billingId,
          serviceName,
          patientId,
          employeeId: empId,
          employeeName: empName,
          isoDate,
          shiftType,
          chargePerDay: Number(partner.charge_per_day ?? chargePerDay),
          payoutPerDay: Number(partner.payout_per_day ?? payoutPerDay),
          payoutTerm: partner.payout_term || payoutTerm
        };

        const existingSvc = await billingRepository.findSvcByDayPartner(
          billingId,
          serviceName,
          isoDate,
          empId,
          access
        );
        if (!existingSvc.success) return passFailure(existingSvc);

        if (!existingSvc.data) {
          const svcRow = buildSvcEntryRow(rowInput);
          const ins = await billingRepository.insertSvc(svcRow, access);
          if (!ins.success) {
            const msg = (ins.error || "").toLowerCase();
            if (!msg.includes("duplicate") && !msg.includes("unique")) return passFailure(ins);
            skipped += 1;
          } else {
            createdSvc += 1;
          }
        } else {
          skipped += 1;
        }

        const existingPay = await billingRepository.findPayoutByDayPartner(
          svcKey,
          isoDate,
          empId,
          access
        );
        if (!existingPay.success) return passFailure(existingPay);

        if (!existingPay.data) {
          const payRow = buildPayoutChargeRow(rowInput);
          const insPay = await billingRepository.insertPayoutCharge(payRow, access);
          if (!insPay.success) {
            const msg = (insPay.error || "").toLowerCase();
            if (!msg.includes("duplicate") && !msg.includes("unique")) return passFailure(insPay);
            skipped += 1;
          } else {
            createdPayout += 1;
          }
        } else {
          skipped += 1;
        }
      }
    }

    await dutyRepository.update(
      dutyId,
      { billing_id: billingId, updated_by: ctx.actor.email },
      access
    );

    return success({
      billing_id: billingId,
      svc_key: svcKey,
      created_svc: createdSvc,
      created_payout: createdPayout,
      skipped,
      days: days.length
    });
  },

  async rollbackDutyDiary(dutyId: string, ctx: DutyServiceContext): Promise<ApiResult<null>> {
    const access = dbAccess(ctx);
    const svc = await dutyRepository.removeSvcEntriesByDutyId(dutyId, access);
    if (!svc.success) return passFailure(svc);
    const pay = await dutyRepository.removePayoutChargesByDutyId(dutyId, access);
    if (!pay.success) return passFailure(pay);
    return success(null);
  },

  async assignExtraPartners(
    duty: JsonRow,
    extra: DutyPartnerAssignment[],
    ctx: DutyServiceContext,
    materialize: boolean
  ): Promise<ApiResult<{ duty: JsonRow; materialize?: MaterializeResult }>> {
    const access = dbAccess(ctx);
    const id = String(duty.id);
    const patch = {
      extra_partners: extra,
      updated_by: ctx.actor.email
    };
    const updated = await dutyRepository.update(id, patch, access);
    if (!updated.success) return passFailure(updated);
    const fresh = await dutyRepository.findById(id, access);
    if (!fresh.success || !fresh.data) {
      return failure("Duty not found after partner update", ErrorCodes.internal);
    }
    if (!materialize) {
      return success({ duty: fresh.data });
    }
    const mat = await dutyDiaryService.materializeDuty(fresh.data, ctx);
    if (!mat.success) return passFailure(mat);
    return success({ duty: fresh.data, materialize: mat.data });
  }
};

/**
 * Materialize duty windows into per-day `hh_svc_entries` + `hh_payout_charges`
 * (legacy duty diary parity). Reconciles creates, updates, and orphan deletes.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { billingSvcKey, canEditBilling } from "@/business/billingRules";
import {
  buildPayoutChargeRow,
  buildSvcEntryRow,
  collectDutyPartners,
  diarySlotKey,
  dutyDiaryRemarks,
  eachDutyCalendarDay,
  expectedDiarySlotKeys,
  normalizeExtraPartners,
  parseDutyDiaryRemarks,
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

export type DiaryRowAction = "create" | "update" | "skip" | "delete";

export interface MaterializePreviewRow {
  date: string;
  employee_id: string;
  employee_name: string;
  charge: number;
  payout: number;
  svc_action: DiaryRowAction;
  payout_action: DiaryRowAction;
}

export interface MaterializeResult {
  billing_id: string;
  svc_key: string;
  created_svc: number;
  created_payout: number;
  updated_svc: number;
  updated_payout: number;
  deleted_svc: number;
  deleted_payout: number;
  skipped: number;
  days: number;
  dry_run?: boolean;
  preview?: MaterializePreviewRow[];
  would_create_svc?: number;
  would_create_payout?: number;
  would_update_svc?: number;
  would_update_payout?: number;
  would_delete_svc?: number;
  would_delete_payout?: number;
}

function rowOwnedByDuty(remarks: string | null | undefined, dutyId: string): boolean {
  const parsed = parseDutyDiaryRemarks(remarks);
  return parsed !== null && parsed.dutyId === dutyId;
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

    const expectedKeys = expectedDiarySlotKeys(String(duty.start_at), String(duty.end_at), partners, {
      from: opts?.from,
      to: opts?.to
    });
    const days = [...expectedKeys].map((k) => k.split(":")[0]);
    const uniqueDays = new Set(days);

    let createdSvc = 0;
    let createdPayout = 0;
    let updatedSvc = 0;
    let updatedPayout = 0;
    let deletedSvc = 0;
    let deletedPayout = 0;
    let skipped = 0;
    const preview: MaterializePreviewRow[] = [];
    const nameCache = new Map<string, string>();

    const existingSvcRows = await dutyRepository.findSvcEntriesByDutyId(dutyId, access);
    if (!existingSvcRows.success) return passFailure(existingSvcRows);
    const existingPayRows = await dutyRepository.findPayoutChargesByDutyId(dutyId, access);
    if (!existingPayRows.success) return passFailure(existingPayRows);

    const svcByKey = new Map<string, JsonRow>();
    for (const row of existingSvcRows.data || []) {
      const parsed = parseDutyDiaryRemarks(String(row.remarks || ""));
      if (parsed) svcByKey.set(diarySlotKey(parsed.isoDate, parsed.employeeId), row);
    }
    const payByKey = new Map<string, JsonRow>();
    for (const row of existingPayRows.data || []) {
      const parsed = parseDutyDiaryRemarks(String(row.remarks || ""));
      if (parsed) payByKey.set(diarySlotKey(parsed.isoDate, parsed.employeeId), row);
    }

    async function resolveName(empId: string): Promise<string> {
      let empName = nameCache.get(empId);
      if (!empName) {
        empName = await employeeDisplayName(empId, ctx);
        nameCache.set(empId, empName);
      }
      return empName;
    }

    async function pruneOrphans(): Promise<ApiResult<null>> {
      for (const [key, row] of svcByKey) {
        if (expectedKeys.has(key)) continue;
        if (opts?.dry_run) {
          const parsed = parseDutyDiaryRemarks(String(row.remarks || ""));
          if (parsed) {
            preview.push({
              date: parsed.isoDate,
              employee_id: parsed.employeeId,
              employee_name: await resolveName(parsed.employeeId),
              charge: 0,
              payout: 0,
              svc_action: "delete",
              payout_action: "skip"
            });
          }
          deletedSvc += 1;
          continue;
        }
        const del = await billingRepository.removeSvc(String(row.id), access);
        if (!del.success) return passFailure(del);
        deletedSvc += 1;
        svcByKey.delete(key);
      }
      for (const [key, row] of payByKey) {
        if (expectedKeys.has(key)) continue;
        if (opts?.dry_run) {
          deletedPayout += 1;
          continue;
        }
        const del = await billingRepository.removePayoutCharge(String(row.id), access);
        if (!del.success) return passFailure(del);
        deletedPayout += 1;
        payByKey.delete(key);
      }
      return success(null);
    }

    async function upsertSlot(
      isoDate: string,
      partner: DutyPartnerAssignment
    ): Promise<ApiResult<null>> {
      const empId = partner.employee_id;
      const empName = await resolveName(empId);
      const key = diarySlotKey(isoDate, empId);
      const chargeAmt = Number(partner.charge_per_day ?? chargePerDay);
      const payoutAmt = Number(partner.payout_per_day ?? payoutPerDay);

      const rowInput = {
        dutyId,
        billingId,
        serviceName,
        patientId,
        employeeId: empId,
        employeeName: empName,
        isoDate,
        shiftType,
        chargePerDay: chargeAmt,
        payoutPerDay: payoutAmt,
        payoutTerm: partner.payout_term || payoutTerm
      };

      const svcRow = buildSvcEntryRow(rowInput);
      const payRow = buildPayoutChargeRow(rowInput);

      let svcAction: DiaryRowAction = "create";
      let payoutAction: DiaryRowAction = "create";

      const ownedSvc = svcByKey.get(key);
      const ownedPay = payByKey.get(key);

      if (ownedSvc) {
        const sameAmt =
          Number(ownedSvc.amt) === chargeAmt && Number(ownedSvc.total) === svcRow.total;
        svcAction = sameAmt ? "skip" : "update";
      } else {
        const daySvc = await billingRepository.findSvcByDayPartner(
          billingId,
          serviceName,
          isoDate,
          empId,
          access
        );
        if (!daySvc.success) return passFailure(daySvc);
        if (daySvc.data) {
          if (rowOwnedByDuty(String(daySvc.data.remarks), dutyId)) {
            svcByKey.set(key, daySvc.data);
            const sameAmt =
              Number(daySvc.data.amt) === chargeAmt && Number(daySvc.data.total) === svcRow.total;
            svcAction = sameAmt ? "skip" : "update";
          } else {
            svcAction = "skip";
          }
        }
      }

      if (ownedPay) {
        const sameAmt = Number(ownedPay.amount) === payoutAmt;
        payoutAction = sameAmt ? "skip" : "update";
      } else {
        const dayPay = await billingRepository.findPayoutByDayPartner(
          svcKey,
          isoDate,
          empId,
          access
        );
        if (!dayPay.success) return passFailure(dayPay);
        if (dayPay.data) {
          if (rowOwnedByDuty(String(dayPay.data.remarks), dutyId)) {
            payByKey.set(key, dayPay.data);
            payoutAction = Number(dayPay.data.amount) === payoutAmt ? "skip" : "update";
          } else {
            payoutAction = "skip";
          }
        }
      }

      if (opts?.dry_run) {
        preview.push({
          date: isoDate,
          employee_id: empId,
          employee_name: empName,
          charge: chargeAmt,
          payout: payoutAmt,
          svc_action: svcAction,
          payout_action: payoutAction
        });
        if (svcAction === "create") createdSvc += 1;
        else if (svcAction === "update") updatedSvc += 1;
        else skipped += 1;
        if (payoutAction === "create") createdPayout += 1;
        else if (payoutAction === "update") updatedPayout += 1;
        else skipped += 1;
        return success(null);
      }

      if (svcAction === "update" && svcByKey.get(key)) {
        const id = String(svcByKey.get(key)!.id);
        const upd = await billingRepository.updateSvc(
          id,
          {
            amt: svcRow.amt,
            total: svcRow.total,
            disc: svcRow.disc,
            partner: empName,
            freq: svcRow.freq,
            remarks: svcRow.remarks
          },
          access
        );
        if (!upd.success) return passFailure(upd);
        updatedSvc += 1;
      } else if (svcAction === "create") {
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

      if (payoutAction === "update" && payByKey.get(key)) {
        const id = String(payByKey.get(key)!.id);
        const upd = await billingRepository.updatePayoutCharge(
          id,
          {
            amount: payRow.amount,
            term: payRow.term,
            partner: empName,
            remarks: payRow.remarks
          },
          access
        );
        if (!upd.success) return passFailure(upd);
        updatedPayout += 1;
      } else if (payoutAction === "create") {
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
      return success(null);
    }

    const pruned = await pruneOrphans();
    if (!pruned.success) return passFailure(pruned);

    for (const isoDate of eachDutyCalendarDay(String(duty.start_at), String(duty.end_at))) {
      if (opts?.from && isoDate < opts.from) continue;
      if (opts?.to && isoDate > opts.to) continue;
      for (const partner of partners) {
        const slot = await upsertSlot(isoDate, partner);
        if (!slot.success) return passFailure(slot);
      }
    }

    if (opts?.dry_run) {
      return success({
        billing_id: billingId,
        svc_key: svcKey,
        created_svc: 0,
        created_payout: 0,
        updated_svc: 0,
        updated_payout: 0,
        deleted_svc: deletedSvc,
        deleted_payout: deletedPayout,
        skipped,
        days: uniqueDays.size,
        dry_run: true,
        preview,
        would_create_svc: createdSvc,
        would_create_payout: createdPayout,
        would_update_svc: updatedSvc,
        would_update_payout: updatedPayout,
        would_delete_svc: deletedSvc,
        would_delete_payout: deletedPayout
      });
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
      updated_svc: updatedSvc,
      updated_payout: updatedPayout,
      deleted_svc: deletedSvc,
      deleted_payout: deletedPayout,
      skipped,
      days: uniqueDays.size,
      dry_run: false
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

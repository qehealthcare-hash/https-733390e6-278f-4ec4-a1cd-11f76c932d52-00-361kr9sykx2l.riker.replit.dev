/**
 * Materialize duty windows into per-day `hh_svc_entries` + `hh_payout_charges`
 * (legacy duty diary parity). Reconciles creates, updates, and orphan deletes.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { billingSvcKey, canEditBilling } from "@/business/billingRules";
import { isPayoutLocked } from "@/business/payoutRules";
import {
  buildPayoutChargeRow,
  addExcludedDaySlot,
  buildSvcEntryRow,
  collectDutyPartners,
  diarySlotKey,
  dutyDiaryRemarks,
  eachDutyCalendarDay,
  excludedDaySet,
  expectedDiarySlotKeys,
  isDayExcluded,
  normalizeExcludedDays,
  normalizeExtraPartners,
  parseDutyDiaryRemarks,
  type DutyPartnerAssignment
} from "@/business/dutyDiaryRules";
import { effectiveMaterializeEndAt, isOpenEndedEndAt } from "@/business/dutyRules";
import { crmDateKeyFromTimestamp, crmTodayEndIso } from "@/utils/crmToday";
import { billingRepository } from "@/database/billingRepository";
import { employeeRepository } from "@/database/employeeRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { payoutRepository } from "@/database/payoutRepository";
import type { JsonRow } from "@/database/types";
import type { DutyServiceContext } from "@/services/dutyService";
import { writeMutationAudit } from "@/services/mutationAudit";
import { failure, passFailure, success } from "@/utils/apiResponse";
import { assertNotStale } from "@/business/concurrencyRules";

function dbAccess(ctx: DutyServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

/**
 * Walk a list of partner_ids and call hh_recompute_payout for each in
 * the given YYYY-MM period. Failures are swallowed (logged via console)
 * — the caller's audit already records the underlying mutation, and we
 * don't want to fail a successful diary edit because the RPC blipped.
 */
async function recomputeForPartners(
  partnerIds: Array<string | null | undefined>,
  isoDate: string,
  ctx: DutyServiceContext
): Promise<void> {
  const period = (isoDate || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(period)) return;
  const access = dbAccess(ctx);
  const unique = Array.from(
    new Set(partnerIds.map((p) => String(p || "").trim()).filter(Boolean))
  );
  await Promise.all(
    unique.map(async (empId) => {
      try {
        await payoutRepository.recomputeRpc(empId, period, access);
      } catch (err) {
        console.error("[dutyDiaryService] recompute payout failed", { empId, period, err });
      }
    })
  );
}

async function emitDiaryAudit(
  ctx: DutyServiceContext,
  dutyId: string,
  action: "create" | "update" | "delete",
  payload: { stamp: string; before?: unknown; after?: unknown }
): Promise<void> {
  try {
    await writeMutationAudit(dbAccess(ctx), ctx.actor, {
      module: "duty_diary",
      entity_id: dutyId,
      action,
      stamp: payload.stamp,
      before: payload.before ?? null,
      after: payload.after ?? null
    });
  } catch (err) {
    console.error("[dutyDiaryService] audit write failed", err);
  }
}

async function employeeDisplayName(id: string, ctx: DutyServiceContext): Promise<string> {
  if (!id) return "";
  const row = await employeeRepository.findById(id, dbAccess(ctx));
  if (!row.success || !row.data) return id;
  const data = row.data as Record<string, unknown>;
  // hh_employees stores the name across fn / mn / ln columns. The legacy
  // path of `full_name || name` returned undefined and fell back to the
  // raw ID, which is why diary rows used to render as "EMP6402…" on the
  // calendar. Compose the full name from the parts, with the lookup
  // view aliases as a backup.
  const fromLookup = String(data.full_name || data.name || "").trim();
  const fromParts = [data.fn, data.mn, data.ln]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return fromLookup || fromParts || id;
}

export type DiaryRowAction = "create" | "update" | "skip" | "delete";

export interface DiaryListEntry {
  date: string;
  employee_id: string;
  partner: string;
  charge: number;
  payout: number;
  manual: boolean;
  svc_id: string | null;
  payout_id: string | null;
  /** Used by the calendar UI to send optimistic-concurrency tokens
   *  on a subsequent PATCH. */
  svc_updated_at?: string;
  payout_updated_at?: string;
}

export interface DiaryListResult {
  duty_id: string;
  entries: DiaryListEntry[];
  /** Populated only on per-duty failure in listDaysBatch. */
  error?: string;
}

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
  duplicate_skipped_svc?: number;
  duplicate_skipped_payout?: number;
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

function normalizedText(value: unknown): string {
  return String(value || "").trim();
}

function sameSvcDiaryIdentity(row: JsonRow, expected: JsonRow): boolean {
  return (
    normalizedText(row.svc_key) === normalizedText(expected.svc_key) &&
    normalizedText(row.billing_id) === normalizedText(expected.billing_id) &&
    normalizedText(row.service_name) === normalizedText(expected.service_name) &&
    normalizedText(row.partner_id) === normalizedText(expected.partner_id) &&
    normalizedText(row.partner) === normalizedText(expected.partner) &&
    normalizedText(row.date) === normalizedText(expected.date) &&
    normalizedText(row.freq) === normalizedText(expected.freq)
  );
}

function samePayoutDiaryIdentity(row: JsonRow, expected: JsonRow): boolean {
  return (
    normalizedText(row.svc_key) === normalizedText(expected.svc_key) &&
    normalizedText(row.billing_id) === normalizedText(expected.billing_id) &&
    normalizedText(row.service_name) === normalizedText(expected.service_name) &&
    normalizedText(row.partner_id) === normalizedText(expected.partner_id) &&
    normalizedText(row.partner) === normalizedText(expected.partner) &&
    normalizedText(row.date) === normalizedText(expected.date) &&
    normalizedText(row.term) === normalizedText(expected.term)
  );
}

export interface RematerializeReport {
  period: string;
  employee_id: string;
  duties_scanned: number;
  duties_materialized: number;
  duties_skipped: number;
  failures: Array<{ duty_id: string; reason: string }>;
}

export const dutyDiaryService = {
  /**
   * Walk every duty involving `employeeId` that overlaps `period` (YYYY-MM)
   * and re-run `materializeDuty` against the period window.
   *
   * Why we need this: payouts read from `hh_payout_charges`, which is filled
   * by materialization. If a duty's rates were edited (or it was created
   * without `materialize: true`), the per-day rows can be missing or stale,
   * producing a ₹0 payout despite duty rows existing. `payoutService.ensure`
   * / `recompute` calls this BEFORE `hh_recompute_payout` so the operator
   * always sees the latest duty calendar reality.
   *
   * Failures are collected per-duty (e.g. patient has no active bill) and
   * surfaced to the caller — the recompute itself still proceeds.
   */
  async rematerializeForEmployeePeriod(
    employeeId: string,
    period: string,
    ctx: DutyServiceContext
  ): Promise<ApiResult<RematerializeReport>> {
    if (!employeeId || !/^\d{4}-\d{2}$/.test(period)) {
      return failure(
        "employeeId + period (YYYY-MM) are required",
        ErrorCodes.badRequest,
        { employeeId, period }
      );
    }
    const access = dbAccess(ctx);
    const [y = 0, mo = 1] = period.split("-").map((n) => parseInt(n, 10));
    const startDay = `${period}-01`;
    // Last day of period as YYYY-MM-DD (works for Dec rollover).
    const lastDate = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const endDay = `${period}-${String(lastDate).padStart(2, "0")}`;
    const fromIso = `${startDay}T00:00:00.000Z`;
    const toIso = `${endDay}T23:59:59.999Z`;

    const list = await dutyRepository.list(
      {
        employeeId,
        from: fromIso,
        to: toIso,
        limit: 500
      },
      access
    );
    if (!list.success) return passFailure(list);
    const rows = list.data?.rows || [];

    const report: RematerializeReport = {
      period,
      employee_id: employeeId,
      duties_scanned: rows.length,
      duties_materialized: 0,
      duties_skipped: 0,
      failures: []
    };

    for (const duty of rows) {
      const status = String(duty.status || "").toUpperCase();
      if (status === "CANCELLED" || status === "NO_SHOW" || status === "DELETED") {
        report.duties_skipped += 1;
        continue;
      }
      try {
        const mat = await this.materializeDuty(duty, ctx, {
          from: startDay,
          to: endDay
        });
        if (mat.success) {
          report.duties_materialized += 1;
        } else {
          report.failures.push({
            duty_id: String(duty.id || ""),
            reason: mat.error || mat.code || "unknown"
          });
        }
      } catch (err) {
        report.failures.push({
          duty_id: String(duty.id || ""),
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return success(report);
  },

  async materializeDuty(
    duty: JsonRow,
    ctx: DutyServiceContext,
    opts?: { from?: string; to?: string; dry_run?: boolean; prune?: boolean }
  ): Promise<ApiResult<MaterializeResult>> {
    const access = dbAccess(ctx);
    const dutyId = String(duty.id);
    const patientId = String(duty.patient_id || "");
    const primaryId = String(duty.employee_id || "");
    const status = String(duty.status || "").toUpperCase();

    if (!patientId || !primaryId) {
      return failure("Duty must have patient_id and employee_id to materialize", ErrorCodes.badRequest);
    }
    if (status === "CANCELLED" || status === "NO_SHOW" || status === "DELETED") {
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

    // Open-ended duties (no explicit end_at, or sentinel 2099-12-31) keep
    // adding per-day rows to the patient's Active bill until the bill is
    // closed. We clip the materialization horizon to whichever comes first:
    //   - today (so we never materialize the future)
    //   - the bill's effective close date (if a closed bill was passed in via opts.to)
    //   - the duty's explicit end_at (if any)
    const materializeEnd = effectiveMaterializeEndAt(
      { end_at: duty.end_at as string | undefined },
      (active.data.closed_at as string | null | undefined) ?? null,
      opts?.to ? `${opts.to}T23:59:59.999Z` : crmTodayEndIso()
    );

    const excludedSlots = excludedDaySet(normalizeExcludedDays(duty.excluded_days));
    const expectedKeys = expectedDiarySlotKeys(String(duty.start_at), materializeEnd, partners, {
      from: opts?.from,
      to: opts?.to,
      excluded: excludedSlots
    });
    const days = [...expectedKeys].map((k) => k.split(":")[0]);
    const uniqueDays = new Set(days);
    const openEnded = isOpenEndedEndAt(duty.end_at as string | undefined);

    let createdSvc = 0;
    let createdPayout = 0;
    let updatedSvc = 0;
    let updatedPayout = 0;
    let deletedSvc = 0;
    let deletedPayout = 0;
    let skipped = 0;
    let duplicateSkippedSvc = 0;
    let duplicateSkippedPayout = 0;
    const preview: MaterializePreviewRow[] = [];
    const nameCache = new Map<string, string>();
    /** employee_id:YYYY-MM → locked (LOCKED/PAID payout row exists). */
    const payoutLockCache = new Map<string, boolean>();

    async function isPartnerPayoutPeriodLocked(
      employeeId: string,
      isoDate: string
    ): Promise<boolean> {
      const period = isoDate.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(period)) return false;
      const cacheKey = `${employeeId}:${period}`;
      if (payoutLockCache.has(cacheKey)) return payoutLockCache.get(cacheKey)!;
      const payoutRow = await payoutRepository.findByEmployeePeriod(employeeId, period, access);
      const locked =
        payoutRow.success &&
        payoutRow.data != null &&
        isPayoutLocked(String(payoutRow.data.status || ""));
      payoutLockCache.set(cacheKey, locked);
      return locked;
    }

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

    // A row is "in-window" if its date falls within the duty's
    // [start_at, materializeEnd] inclusive. Manual-marker rows whose
    // date is in-window must NOT be deleted — the operator has
    // explicitly reassigned that slot to a partner that the duty's
    // current partner list doesn't yet include (or to themselves with
    // edited rates). They are still pruned when the date falls outside
    // the duty's window (date-shrink / cancel still cleans up).
    //
    // CRITICAL — these MUST be IST date keys, not UTC slices. The
    // legacy `slice(0, 10)` returned the UTC date of the timestamp,
    // so a duty whose start_at was `2026-04-30T18:30:00Z` (00:00 IST
    // May 1) would compute startDay = "2026-04-30" while
    // eachDutyCalendarDay yields ["2026-05-01", ...]. Manual rows
    // dated May 1 then sat outside `[startDay, endDay]` and got
    // pruned even though they were inside the duty's IST window.
    const startDay = crmDateKeyFromTimestamp(String(duty.start_at || ""));
    const endDay = crmDateKeyFromTimestamp(materializeEnd);
    function isInWindow(iso: string): boolean {
      if (!iso) return false;
      return iso >= startDay && iso <= endDay;
    }

    async function pruneOrphans(): Promise<ApiResult<null>> {
      for (const [key, row] of svcByKey) {
        if (expectedKeys.has(key)) continue;
        const parsed = parseDutyDiaryRemarks(String(row.remarks || ""));
        if (parsed?.manual && isInWindow(parsed.isoDate)) {
          // Honour the manual override — operator has reassigned this
          // slot to a partner outside the duty's nominal partner list.
          skipped += 1;
          continue;
        }
        if (opts?.dry_run) {
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
        const parsed = parseDutyDiaryRemarks(String(row.remarks || ""));
        if (parsed?.manual && isInWindow(parsed.isoDate)) {
          skipped += 1;
          continue;
        }
        if (
          parsed &&
          (await isPartnerPayoutPeriodLocked(parsed.employeeId, parsed.isoDate))
        ) {
          skipped += 1;
          continue;
        }
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
      if (isDayExcluded(excludedSlots, isoDate, empId)) {
        skipped += 1;
        return success(null);
      }
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

      const svcRow = buildSvcEntryRow(rowInput, ctx.actor.email);
      const payRow = buildPayoutChargeRow(rowInput, ctx.actor.email);

      let svcAction: DiaryRowAction = "create";
      let payoutAction: DiaryRowAction = "create";

      const ownedSvc = svcByKey.get(key);
      const ownedPay = payByKey.get(key);
      const payoutPeriodLocked = await isPartnerPayoutPeriodLocked(empId, isoDate);

      if (ownedSvc) {
        const ownedParsed = parseDutyDiaryRemarks(String(ownedSvc.remarks || ""));
        if (ownedParsed?.manual) {
          svcAction = "skip";
        } else {
          const sameAmt =
            Number(ownedSvc.amt) === chargeAmt && Number(ownedSvc.total) === svcRow.total;
          svcAction = sameAmt && sameSvcDiaryIdentity(ownedSvc, svcRow) ? "skip" : "update";
        }
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
            const parsed = parseDutyDiaryRemarks(String(daySvc.data.remarks || ""));
            if (parsed?.manual) {
              svcAction = "skip";
            } else {
              const sameAmt =
                Number(daySvc.data.amt) === chargeAmt && Number(daySvc.data.total) === svcRow.total;
              svcAction =
                sameAmt && sameSvcDiaryIdentity(daySvc.data, svcRow) ? "skip" : "update";
            }
          } else {
            svcAction = "skip";
          }
        }
      }

      if (payoutPeriodLocked) {
        payoutAction = "skip";
      } else if (ownedPay) {
        const ownedParsed = parseDutyDiaryRemarks(String(ownedPay.remarks || ""));
        if (ownedParsed?.manual) {
          payoutAction = "skip";
        } else {
          const sameAmt = Number(ownedPay.amount) === payoutAmt;
          payoutAction = sameAmt && samePayoutDiaryIdentity(ownedPay, payRow) ? "skip" : "update";
        }
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
            const parsed = parseDutyDiaryRemarks(String(dayPay.data.remarks || ""));
            if (parsed?.manual) {
              payoutAction = "skip";
            } else {
              payoutAction =
                Number(dayPay.data.amount) === payoutAmt &&
                samePayoutDiaryIdentity(dayPay.data, payRow)
                  ? "skip"
                  : "update";
            }
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
            svc_key: svcRow.svc_key,
            billing_id: svcRow.billing_id,
            service_name: svcRow.service_name,
            partner_id: svcRow.partner_id,
            date: svcRow.date,
            amt: svcRow.amt,
            count: svcRow.count,
            total: svcRow.total,
            disc: svcRow.disc,
            partner: svcRow.partner || empName,
            freq: svcRow.freq,
            remarks: svcRow.remarks,
            updated_by: ctx.actor.email
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
          duplicateSkippedSvc += 1;
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
            svc_key: payRow.svc_key,
            billing_id: payRow.billing_id,
            service_name: payRow.service_name,
            partner_id: payRow.partner_id,
            date: payRow.date,
            amount: payRow.amount,
            term: payRow.term,
            partner: payRow.partner || empName,
            remarks: payRow.remarks,
            updated_by: ctx.actor.email
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
          duplicateSkippedPayout += 1;
          skipped += 1;
        } else {
          createdPayout += 1;
        }
      } else {
        skipped += 1;
      }
      return success(null);
    }

    if (opts?.prune !== false) {
      const pruned = await pruneOrphans();
      if (!pruned.success) return passFailure(pruned);
    }

    for (const isoDate of eachDutyCalendarDay(String(duty.start_at), materializeEnd)) {
      if (opts?.from && isoDate < opts.from) continue;
      if (opts?.to && isoDate > opts.to) continue;
      for (const partner of partners) {
        const slot = await upsertSlot(isoDate, partner);
        if (!slot.success) return passFailure(slot);
      }
    }
    void openEnded;

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

    const existingBillingId = String(duty.billing_id || "");
    if (existingBillingId !== billingId) {
      await dutyRepository.update(
        dutyId,
        { billing_id: billingId, updated_by: ctx.actor.email },
        access
      );
    }

    const result: MaterializeResult = {
      billing_id: billingId,
      svc_key: svcKey,
      created_svc: createdSvc,
      created_payout: createdPayout,
      updated_svc: updatedSvc,
      updated_payout: updatedPayout,
      deleted_svc: deletedSvc,
      deleted_payout: deletedPayout,
      skipped,
      duplicate_skipped_svc: duplicateSkippedSvc,
      duplicate_skipped_payout: duplicateSkippedPayout,
      days: uniqueDays.size,
      dry_run: false
    };
    const mutated =
      createdSvc +
      createdPayout +
      updatedSvc +
      updatedPayout +
      deletedSvc +
      deletedPayout +
      duplicateSkippedSvc +
      duplicateSkippedPayout;
    if (mutated > 0) {
      await emitDiaryAudit(ctx, dutyId, "update", {
        stamp:
          `Materialize · +${createdSvc}/${createdPayout} created` +
          ` · ~${updatedSvc}/${updatedPayout} updated` +
          ` · -${deletedSvc}/${deletedPayout} pruned` +
          (duplicateSkippedSvc + duplicateSkippedPayout > 0
            ? ` · dup-skip ${duplicateSkippedSvc}/${duplicateSkippedPayout}`
            : ""),
        before: null,
        after: result
      });
    }

    // Cross-duty cleanup: drop phantom IST rows + dedup per-day across
    // handovers/overlapping duties. Per-duty materialize cannot see other
    // duties' rows, so this is run once on the parent billing each pass.
    // Best-effort: if it fails we still return the materialize result.
    try {
      const dedup = await billingRepository.dedupBillingDiaryRpc(billingId, access);
      if (dedup.success && dedup.data) {
        const d = dedup.data;
        const total =
          (d.svc_phantoms_deleted || 0) +
          (d.payout_phantoms_deleted || 0) +
          (d.svc_duplicates_deleted || 0) +
          (d.payout_duplicates_deleted || 0);
        if (total > 0) {
          await emitDiaryAudit(ctx, dutyId, "update", {
            stamp:
              `Diary dedup · svc-phantom:${d.svc_phantoms_deleted}` +
              ` payout-phantom:${d.payout_phantoms_deleted}` +
              ` svc-dup:${d.svc_duplicates_deleted}` +
              ` payout-dup:${d.payout_duplicates_deleted}`,
            before: null,
            after: d
          });
        }
      } else if (!dedup.success) {
        console.error("[materializeDuty] dedup helper failed", dedup.error);
      }
    } catch (err) {
      console.error("[materializeDuty] dedup helper threw", err);
    }

    return success(result);
  },

  /**
   * Per-day diary entries for a duty (one row per partner × calendar day),
   * ordered by date asc then partner. Includes a `manual` flag so the UI
   * can show whether each row will resist the next sync.
   */
  async listDays(
    dutyId: string,
    ctx: DutyServiceContext
  ): Promise<ApiResult<DiaryListResult>> {
    const access = dbAccess(ctx);
    const svcRows = await dutyRepository.findSvcEntriesByDutyId(dutyId, access);
    if (!svcRows.success) return passFailure(svcRows);
    const payRows = await dutyRepository.findPayoutChargesByDutyId(dutyId, access);
    if (!payRows.success) return passFailure(payRows);

    type Slot = DiaryListEntry & { svc_updated_at?: string; payout_updated_at?: string };
    const slots = new Map<string, Slot>();
    for (const row of svcRows.data || []) {
      const parsed = parseDutyDiaryRemarks(String(row.remarks || ""));
      if (!parsed) continue;
      const key = `${parsed.isoDate}|${parsed.employeeId}`;
      const slot: Slot = slots.get(key) || {
        date: parsed.isoDate,
        employee_id: parsed.employeeId,
        partner: String(row.partner || ""),
        charge: Number(row.total ?? row.amt ?? 0),
        payout: 0,
        manual: parsed.manual,
        svc_id: String(row.id),
        payout_id: null
      };
      slot.charge = Number(row.total ?? row.amt ?? 0);
      slot.partner = String(row.partner || slot.partner);
      slot.svc_id = String(row.id);
      slot.manual = slot.manual || parsed.manual;
      if (row.updated_at) slot.svc_updated_at = String(row.updated_at);
      slots.set(key, slot);
    }
    for (const row of payRows.data || []) {
      const parsed = parseDutyDiaryRemarks(String(row.remarks || ""));
      if (!parsed) continue;
      const key = `${parsed.isoDate}|${parsed.employeeId}`;
      const slot: Slot = slots.get(key) || {
        date: parsed.isoDate,
        employee_id: parsed.employeeId,
        partner: String(row.partner || ""),
        charge: 0,
        payout: Number(row.amount ?? 0),
        manual: parsed.manual,
        svc_id: null,
        payout_id: String(row.id)
      };
      slot.payout = Number(row.amount ?? 0);
      slot.partner = slot.partner || String(row.partner || "");
      slot.payout_id = String(row.id);
      slot.manual = slot.manual || parsed.manual;
      if (row.updated_at) slot.payout_updated_at = String(row.updated_at);
      slots.set(key, slot);
    }

    const entries = [...slots.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.employee_id < b.employee_id ? -1 : 1;
    });
    return success({ duty_id: dutyId, entries });
  },

  /**
   * Update charge, payout, and/or partner for a specific day × partner of
   * a duty. Marks the entry as manual so subsequent materialize passes
   * don't overwrite the override. Pass `clear_manual: true` to drop the
   * lock and let the next sync reconcile back to the duty's defaults.
   *
   * Hardening (audit follow-up):
   *   - Refuses if the source date is already in hh_paid_transactions for
   *     the original partner (we don't break payment reconciliation).
   *   - Auto-adds the reassignment target to the duty's extra_partners
   *     when promotion would otherwise let the pruner delete the row on
   *     the next materialize.
   *   - Recomputes payouts for BOTH the original and target partner for
   *     the slot's YYYY-MM, so monthly statements are kept in sync.
   *   - Honours optimistic concurrency: caller can pass `svc_updated_at`
   *     and/or `payout_updated_at` and a 409 is returned on stale write.
   *   - Stamps updated_by on both svc + payout rows.
   *   - Writes a `module: "duty_diary"` row to hh_audit_logs with the
   *     before/after snapshot.
   */
  async updateDay(
    dutyId: string,
    isoDate: string,
    employeeId: string,
    patch: {
      charge?: number;
      payout?: number;
      new_employee_id?: string;
      clear_manual?: boolean;
      svc_updated_at?: string;
      payout_updated_at?: string;
    },
    ctx: DutyServiceContext
  ): Promise<
    ApiResult<{
      svc_updated: boolean;
      payout_updated: boolean;
      manual: boolean;
      partner_changed: boolean;
      employee_id: string;
      promoted_partner: boolean;
    }>
  > {
    const access = dbAccess(ctx);
    if (!dutyId || !isoDate || !employeeId) {
      return failure("dutyId, isoDate, and employeeId are required", ErrorCodes.badRequest);
    }
    const manual = !patch.clear_manual;
    const targetEmployee =
      patch.new_employee_id && patch.new_employee_id.trim()
        ? patch.new_employee_id.trim()
        : employeeId;
    const partnerChanged = targetEmployee !== employeeId;

    // P1 — refuse edits that would break payment reconciliation.
    const sourcePaid = await payoutRepository.isDayPaid(employeeId, isoDate, access);
    if (!sourcePaid.success) return passFailure(sourcePaid);
    if (sourcePaid.data) {
      return failure(
        "This day is already disbursed in hh_paid_transactions — reverse the payment before editing.",
        ErrorCodes.business
      );
    }
    if (partnerChanged) {
      const targetPaid = await payoutRepository.isDayPaid(targetEmployee, isoDate, access);
      if (!targetPaid.success) return passFailure(targetPaid);
      if (targetPaid.data) {
        return failure(
          "Target partner already has a paid transaction covering this day — reverse the payment first.",
          ErrorCodes.business
        );
      }
    }

    const svcAll = await dutyRepository.findSvcEntriesByDutyId(dutyId, access);
    if (!svcAll.success) return passFailure(svcAll);
    const payAll = await dutyRepository.findPayoutChargesByDutyId(dutyId, access);
    if (!payAll.success) return passFailure(payAll);

    const svcRow = (svcAll.data || []).find((r) => {
      const p = parseDutyDiaryRemarks(String(r.remarks || ""));
      return p && p.isoDate === isoDate && p.employeeId === employeeId;
    });
    const payRow = (payAll.data || []).find((r) => {
      const p = parseDutyDiaryRemarks(String(r.remarks || ""));
      return p && p.isoDate === isoDate && p.employeeId === employeeId;
    });

    if (!svcRow && !payRow) {
      return failure("No diary entry for that day and partner", ErrorCodes.notFound);
    }

    // P1 — optimistic concurrency.
    if (svcRow && patch.svc_updated_at) {
      const stale = assertNotStale("Diary svc row", svcRow.updated_at, patch.svc_updated_at);
      if (!stale.success) return passFailure(stale);
    }
    if (payRow && patch.payout_updated_at) {
      const stale = assertNotStale("Diary payout row", payRow.updated_at, patch.payout_updated_at);
      if (!stale.success) return passFailure(stale);
    }

    if (partnerChanged) {
      const dupSvc = (svcAll.data || []).some((r) => {
        const p = parseDutyDiaryRemarks(String(r.remarks || ""));
        return p && p.isoDate === isoDate && p.employeeId === targetEmployee;
      });
      const dupPay = (payAll.data || []).some((r) => {
        const p = parseDutyDiaryRemarks(String(r.remarks || ""));
        return p && p.isoDate === isoDate && p.employeeId === targetEmployee;
      });
      if (dupSvc || dupPay) {
        return failure(
          "That partner already has an entry on this day for this duty — edit or delete it first.",
          ErrorCodes.duplicate
        );
      }
    }

    const newPartnerName = partnerChanged
      ? await employeeDisplayName(targetEmployee, ctx)
      : "";

    // Snapshot for audit.
    const beforeSnapshot = {
      duty_id: dutyId,
      date: isoDate,
      employee_id: employeeId,
      svc: svcRow
        ? { id: svcRow.id, amt: svcRow.amt, total: svcRow.total, partner_id: svcRow.partner_id }
        : null,
      payout: payRow
        ? { id: payRow.id, amount: payRow.amount, partner_id: payRow.partner_id }
        : null
    };

    // P0 — auto-promote the new partner into extra_partners so the next
    // materialize considers it expected and pruneOrphans won't delete it.
    let promotedPartner = false;
    if (partnerChanged) {
      const dutyLookup = await dutyRepository.findById(dutyId, access);
      if (!dutyLookup.success) return passFailure(dutyLookup);
      const duty = dutyLookup.data;
      const primaryId = duty ? String(duty.employee_id || "") : "";
      const currentExtra = normalizeExtraPartners(duty?.extra_partners);
      const alreadyKnown =
        targetEmployee === primaryId ||
        currentExtra.some((p) => p.employee_id === targetEmployee);
      if (!alreadyKnown) {
        const nextExtra = currentExtra.concat([
          {
            employee_id: targetEmployee,
            charge_per_day: Number(svcRow?.amt ?? duty?.charge_per_day ?? 0),
            payout_per_day: Number(payRow?.amount ?? duty?.payout_per_day ?? 0),
            payout_term: String(duty?.payout_term || "Daily")
          }
        ]);
        const promoted = await dutyRepository.update(
          dutyId,
          { extra_partners: nextExtra, updated_by: ctx.actor.email },
          access
        );
        if (!promoted.success) return passFailure(promoted);
        promotedPartner = true;
      }
    }

    let svcUpdated = false;
    let payoutUpdated = false;
    const newRemarks = dutyDiaryRemarks(dutyId, isoDate, targetEmployee, manual);

    if (svcRow) {
      const nextCharge =
        typeof patch.charge === "number" && Number.isFinite(patch.charge)
          ? Math.max(0, patch.charge)
          : Number(svcRow.amt ?? 0);
      const svcPatch: Record<string, unknown> = {
        svc_key: svcRow.svc_key,
        billing_id: svcRow.billing_id,
        service_name: svcRow.service_name,
        partner_id: targetEmployee,
        partner: partnerChanged ? newPartnerName || targetEmployee : svcRow.partner || targetEmployee,
        date: svcRow.date || isoDate,
        freq: svcRow.freq,
        amt: nextCharge,
        count: svcRow.count,
        total: nextCharge,
        disc: svcRow.disc,
        remarks: newRemarks,
        updated_by: ctx.actor.email
      };
      const upd = await billingRepository.updateSvc(String(svcRow.id), svcPatch, access);
      if (!upd.success) return passFailure(upd);
      svcUpdated = true;
    }
    if (payRow) {
      const nextPayout =
        typeof patch.payout === "number" && Number.isFinite(patch.payout)
          ? Math.max(0, patch.payout)
          : Number(payRow.amount ?? 0);
      const payPatch: Record<string, unknown> = {
        svc_key: payRow.svc_key,
        billing_id: payRow.billing_id,
        service_name: payRow.service_name,
        partner_id: targetEmployee,
        partner: partnerChanged ? newPartnerName || targetEmployee : payRow.partner || targetEmployee,
        date: payRow.date || isoDate,
        amount: nextPayout,
        term: payRow.term,
        remarks: newRemarks,
        updated_by: ctx.actor.email
      };
      const upd = await billingRepository.updatePayoutCharge(String(payRow.id), payPatch, access);
      if (!upd.success) return passFailure(upd);
      payoutUpdated = true;
    }

    // When a day is reassigned away from an extra partner, drop them from
    // extra_partners if no other diary slot still references them — otherwise
    // the next materialize recreates their default row every day.
    let demotedPartner = false;
    if (partnerChanged && employeeId) {
      const dutyForDemote = await dutyRepository.findById(dutyId, access);
      if (dutyForDemote.success && dutyForDemote.data) {
        const primary = String(dutyForDemote.data.employee_id || "");
        if (employeeId !== primary) {
          const stillOnDuty = [...(svcAll.data || []), ...(payAll.data || [])].some((r) => {
            const p = parseDutyDiaryRemarks(String(r.remarks || ""));
            if (!p || p.employeeId !== employeeId) return false;
            if (p.isoDate === isoDate) return false;
            return true;
          });
          if (!stillOnDuty) {
            const currentExtra = normalizeExtraPartners(dutyForDemote.data.extra_partners);
            const nextExtra = currentExtra.filter((p) => p.employee_id !== employeeId);
            if (nextExtra.length !== currentExtra.length) {
              const dem = await dutyRepository.update(
                dutyId,
                { extra_partners: nextExtra, updated_by: ctx.actor.email },
                access
              );
              demotedPartner = dem.success;
            }
          }
        }
      }
    }

    await recomputeForPartners([employeeId, targetEmployee], isoDate, ctx);

    await emitDiaryAudit(ctx, dutyId, "update", {
      stamp:
        `Day edit ${isoDate}` +
        (partnerChanged ? ` · partner ${employeeId} → ${targetEmployee}` : "") +
        (manual ? " · manual lock on" : " · manual lock cleared") +
        (promotedPartner ? " · promoted target to extra_partners" : "") +
        (demotedPartner ? ` · removed ${employeeId} from extra_partners` : ""),
      before: beforeSnapshot,
      after: {
        duty_id: dutyId,
        date: isoDate,
        employee_id: targetEmployee,
        charge:
          typeof patch.charge === "number"
            ? Math.max(0, patch.charge)
            : Number(svcRow?.amt ?? 0),
        payout:
          typeof patch.payout === "number"
            ? Math.max(0, patch.payout)
            : Number(payRow?.amount ?? 0),
        manual,
        partner_changed: partnerChanged,
        promoted_partner: promotedPartner,
        demoted_partner: demotedPartner
      }
    });

    return success({
      svc_updated: svcUpdated,
      payout_updated: payoutUpdated,
      manual,
      partner_changed: partnerChanged,
      employee_id: targetEmployee,
      promoted_partner: promotedPartner
    });
  },

  /**
   * Hard-delete a single day × partner pair from the diary. The next
   * materialize pass will recreate it from the duty defaults unless the
   * caller also shrinks the duty's window — use this for skipping a single
   * absence day when the operator doesn't want to cancel the duty.
   *
   * Hardening (audit follow-up):
   *   - Refuses if hh_paid_transactions already covers (employee, date).
   *   - Triggers payout recompute for the partner whose row was removed.
   *   - Writes a `module: "duty_diary"` audit row.
   */
  async deleteDay(
    dutyId: string,
    isoDate: string,
    employeeId: string,
    ctx: DutyServiceContext
  ): Promise<ApiResult<{ svc_deleted: boolean; payout_deleted: boolean }>> {
    const access = dbAccess(ctx);
    if (!dutyId || !isoDate || !employeeId) {
      return failure("dutyId, isoDate, and employeeId are required", ErrorCodes.badRequest);
    }

    const paid = await payoutRepository.isDayPaid(employeeId, isoDate, access);
    if (!paid.success) return passFailure(paid);
    if (paid.data) {
      return failure(
        "This day is already disbursed in hh_paid_transactions — reverse the payment before deleting.",
        ErrorCodes.business
      );
    }

    const svcAll = await dutyRepository.findSvcEntriesByDutyId(dutyId, access);
    if (!svcAll.success) return passFailure(svcAll);
    const payAll = await dutyRepository.findPayoutChargesByDutyId(dutyId, access);
    if (!payAll.success) return passFailure(payAll);

    const svcRow = (svcAll.data || []).find((r) => {
      const p = parseDutyDiaryRemarks(String(r.remarks || ""));
      return p && p.isoDate === isoDate && p.employeeId === employeeId;
    });
    const payRow = (payAll.data || []).find((r) => {
      const p = parseDutyDiaryRemarks(String(r.remarks || ""));
      return p && p.isoDate === isoDate && p.employeeId === employeeId;
    });

    const beforeSnapshot = {
      duty_id: dutyId,
      date: isoDate,
      employee_id: employeeId,
      svc: svcRow
        ? { id: svcRow.id, amt: svcRow.amt, total: svcRow.total, partner_id: svcRow.partner_id }
        : null,
      payout: payRow
        ? { id: payRow.id, amount: payRow.amount, partner_id: payRow.partner_id }
        : null
    };

    let svcDeleted = false;
    let payoutDeleted = false;
    if (svcRow) {
      const del = await billingRepository.removeSvc(String(svcRow.id), access);
      if (!del.success) return passFailure(del);
      svcDeleted = true;
    }
    if (payRow) {
      const del = await billingRepository.removePayoutCharge(String(payRow.id), access);
      if (!del.success) return passFailure(del);
      payoutDeleted = true;
    }

    await recomputeForPartners([employeeId], isoDate, ctx);

    const dutyLookup = await dutyRepository.findById(dutyId, access);
    if (!dutyLookup.success) return passFailure(dutyLookup);
    const nextExcluded = addExcludedDaySlot(
      normalizeExcludedDays(dutyLookup.data?.excluded_days),
      isoDate,
      employeeId
    );
    const excludedPatch = await dutyRepository.update(
      dutyId,
      { excluded_days: nextExcluded, updated_by: ctx.actor.email },
      access
    );
    if (!excludedPatch.success) return passFailure(excludedPatch);

    await emitDiaryAudit(ctx, dutyId, "delete", {
      stamp: `Day excluded ${isoDate} · partner ${employeeId} (will not re-materialize)`,
      before: beforeSnapshot,
      after: { excluded_days: nextExcluded }
    });

    return success({ svc_deleted: svcDeleted, payout_deleted: payoutDeleted });
  },

  /**
   * Collect every (employee_id, isoDate) slot materialized for a duty.
   * Used before cancel / hard-delete to refuse rollback when payroll has
   * already disbursed any of those days.
   */
  async collectDiaryPaidSlots(
    dutyId: string,
    ctx: DutyServiceContext
  ): Promise<ApiResult<Array<{ employee_id: string; iso_date: string }>>> {
    const listed = await dutyDiaryService.listDays(dutyId, ctx);
    if (!listed.success) return passFailure(listed);
    const slots = (listed.data?.entries || []).map((e) => ({
      employee_id: e.employee_id,
      iso_date: e.date
    }));
    return success(slots);
  },

  async assertDutyDiaryNotDisbursed(
    dutyId: string,
    ctx: DutyServiceContext
  ): Promise<ApiResult<null>> {
    const slots = await dutyDiaryService.collectDiaryPaidSlots(dutyId, ctx);
    if (!slots.success) return passFailure(slots);
    if (!slots.data?.length) return success(null);
    const paid = await payoutRepository.anyDayPaid(slots.data, dbAccess(ctx));
    if (!paid.success) return passFailure(paid);
    if (paid.data?.paid) {
      return failure(
        `Cannot remove diary — ${paid.data.employee_id} on ${paid.data.iso_date} is already in hh_paid_transactions. Reverse the payout first.`,
        ErrorCodes.business,
        paid.data
      );
    }
    return success(null);
  },

  async rollbackDutyDiary(dutyId: string, ctx: DutyServiceContext): Promise<ApiResult<null>> {
    const access = dbAccess(ctx);
    const paidGuard = await dutyDiaryService.assertDutyDiaryNotDisbursed(dutyId, ctx);
    if (!paidGuard.success) return passFailure(paidGuard);
    const svc = await dutyRepository.removeSvcEntriesByDutyId(dutyId, access);
    if (!svc.success) return passFailure(svc);
    const pay = await dutyRepository.removePayoutChargesByDutyId(dutyId, access);
    if (!pay.success) return passFailure(pay);
    return success(null);
  },

  /**
   * Batched diary fetch for the calendar — avoids the N+1 problem where
   * each duty in the visible month requires its own /diary call. Returns
   * a map of dutyId → entries (same shape as `listDays`).
   */
  async listDaysBatch(
    dutyIds: string[],
    ctx: DutyServiceContext
  ): Promise<ApiResult<Record<string, DiaryListResult>>> {
    const unique = Array.from(new Set((dutyIds || []).map((d) => String(d || "").trim()).filter(Boolean)));
    const out: Record<string, DiaryListResult> = {};
    // Concurrency is capped at 10 to avoid stampeding the database from
    // huge calendars; in practice each call resolves in tens of ms.
    const concurrency = 10;
    for (let i = 0; i < unique.length; i += concurrency) {
      const batch = unique.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((id) => dutyDiaryService.listDays(id, ctx)));
      batch.forEach((id, idx) => {
        const r = results[idx];
        if (r && r.success && r.data) {
          out[id] = r.data;
        } else {
          out[id] = {
            duty_id: id,
            entries: [],
            error: (r && r.success ? "Empty diary payload" : r?.error) || "Failed to load diary"
          };
        }
      });
    }
    return success(out);
  },

  async assignExtraPartners(
    duty: JsonRow,
    extra: DutyPartnerAssignment[],
    ctx: DutyServiceContext,
    materialize: boolean
  ): Promise<ApiResult<{ duty: JsonRow; materialize?: MaterializeResult }>> {
    const access = dbAccess(ctx);
    const id = String(duty.id);
    const prevExtra = normalizeExtraPartners(duty.extra_partners);
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
    let matResult: MaterializeResult | undefined;
    if (materialize) {
      const mat = await dutyDiaryService.materializeDuty(fresh.data, ctx);
      if (!mat.success) return passFailure(mat);
      matResult = mat.data;
    }

    // IST date key — UTC slice would put a duty starting at 18:30 UTC
    // on Apr 30 (which is 00:00 IST May 1) into the April payout period
    // and never recompute May, leaving the partner's payslip stale.
    const monthAnchor = crmDateKeyFromTimestamp(
      String(duty.start_at || new Date().toISOString())
    );
    const partnerIds = Array.from(
      new Set(
        prevExtra
          .map((p) => p.employee_id)
          .concat(extra.map((p) => p.employee_id))
          .concat([String(duty.employee_id || "")])
      )
    ).filter(Boolean);
    await recomputeForPartners(partnerIds, monthAnchor, ctx);

    await emitDiaryAudit(ctx, id, "update", {
      stamp: `Extra partners updated · ${prevExtra.length} → ${extra.length}`,
      before: { extra_partners: prevExtra },
      after: { extra_partners: extra, materialize: matResult ?? null }
    });

    return success({ duty: fresh.data, materialize: matResult });
  }
};

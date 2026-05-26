/**
 * Payout service — corporate-grade layered facade.
 *
 * Composes /src/validation/payoutValidation + /src/business/payoutRules +
 * /src/database/payoutRepository + /src/database/dutyRepository +
 * /src/database/attendanceRepository + /src/database/auditRepository.
 *
 * Hardened rules (Phase 5 Payout):
 *   - Gross / duty_count / hours are *always* computed by
 *     `hh_recompute_payout` from `hh_duties` + `hh_attendance` — never trusted
 *     from the frontend.
 *   - Adjustments (advance / deduction / bonus / remarks) flow through
 *     `mergePayoutAdjustments` which recomputes `net_amount` server-side.
 *   - One payout row per `(employee_id, period_month)` (matches the DB
 *     `hh_payouts_unique` constraint). Multi-patient breakdown is *derived*
 *     from duties / attendance and surfaced for UI / reports.
 *   - Status machine `OPEN → LOCKED → PAID` with reopen requiring an
 *     audited reason. PAID is terminal.
 *   - Every mutation refetches the persisted row + writes an audit log.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import {
  payoutSchema,
  payoutAdjustmentSchema,
  payoutPaySchema,
  payoutAdvanceSchema,
  payoutLockSchema,
  payoutReopenSchema,
  payoutRecomputeSchema,
  payoutListQuerySchema,
  payoutPendingQuerySchema,
  replacePayoutChargesSchema,
  type PayoutInput,
  type PayoutAdjustmentInput,
  type PayoutPayInput,
  type PayoutAdvanceInput,
  type PayoutLockInput,
  type PayoutReopenInput,
  type PayoutRecomputeInput,
  type PayoutListQuery,
  type PayoutPendingQuery,
  type ReplacePayoutChargesInput
} from "@/validation/payoutValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  breakdownByPatient,
  canEditPayout,
  canLockPayout,
  canMarkPayoutPaid,
  canPayAdvance,
  canPayoutTransitionTo,
  canReopenPayout,
  computePayoutNet,
  ensurePayoutHasSource,
  ensureWithinPayoutOutstanding,
  isPayoutFullyPaid,
  mergePayoutAdjustments,
  payoutLockRow,
  payoutPaidRow,
  payoutReopenRow,
  sumPayoutTotals,
  validatePayoutAmounts,
  type PayoutPatientBreakdownRow,
  type PayoutTotals
} from "@/business/payoutRules";
import { assertNotStale } from "@/business/concurrencyRules";
import { monthRangeUTC } from "@/business/dateRules";
import { newId } from "@/business/idRules";
import { payoutRepository } from "@/database/payoutRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { attendanceRepository } from "@/database/attendanceRepository";
import { employeeRepository } from "@/database/employeeRepository";
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

export interface PayoutServiceContext {
  actor: ServiceActor;
  accessToken?: string;
}

function dbAccess(ctx: PayoutServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function fireAudit(
  ctx: PayoutServiceContext,
  payload: {
    entity_id: string;
    action: "create" | "update" | "close" | "delete";
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module: "payout",
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

async function loadPayout(
  id: string,
  ctx: PayoutServiceContext
): Promise<LoadResult<JsonRow>> {
  const row = await payoutRepository.findById(id, dbAccess(ctx));
  if (!row.success) return toLoadFailure(row);
  if (!row.data) return toLoadFailure(notFoundFailure("Payout", id));
  return { success: true, data: row.data };
}

async function loadFreshPayout(
  id: string,
  ctx: PayoutServiceContext,
  fallback?: JsonRow | null
): Promise<LoadResult<JsonRow>> {
  const refreshed = await payoutRepository.findById(id, dbAccess(ctx));
  if (!refreshed.success) return toLoadFailure(refreshed);
  const row = refreshed.data ?? fallback ?? null;
  if (!row) return toLoadFailure(failure("Payout not found after mutation", ErrorCodes.internal));
  return { success: true, data: row };
}

export interface PayoutDetail {
  payout: JsonRow;
  duties: JsonRow[];
  attendance: JsonRow[];
  breakdown: PayoutPatientBreakdownRow[];
  /** All disbursements against this payout (oldest-first). */
  paid_transactions: JsonRow[];
  /** Sum of all disbursement amounts already recorded against this payout. */
  paid_total: number;
  /** Net outstanding = net_amount − paid_total (never negative). */
  outstanding: number;
  /** Display-friendly employee name resolved from `hh_employees`. */
  employee_name: string;
}

/**
 * Compose a display name from an `hh_employees` row. Mirrors the lookup
 * view's resolution so the same name string surfaces in payouts, billing,
 * and duty calendar.
 */
function composeEmployeeName(row: JsonRow | null | undefined): string {
  if (!row) return "";
  const direct = (row.full_name as string | undefined)?.trim();
  if (direct) return direct;
  const parts = [row.fn, row.mn, row.ln]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  return parts.join(" ");
}

/**
 * Resolve display names for a set of employee ids in one shot. Returns a
 * `Map<id, displayName>` falling back to the raw id when an employee row
 * is missing so the UI never renders an empty cell.
 */
async function hydrateEmployeeNames(
  ids: string[],
  ctx: PayoutServiceContext
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set((ids || []).filter((x) => !!x)));
  if (!unique.length) return map;
  const rows = await employeeRepository.findByIds(unique, dbAccess(ctx));
  if (rows.success && Array.isArray(rows.data)) {
    for (const row of rows.data) {
      const id = String(row.id || "");
      if (!id) continue;
      const name = composeEmployeeName(row);
      map.set(id, name || id);
    }
  }
  // Fill in missing ids so callers can always read from the map.
  for (const id of unique) {
    if (!map.has(id)) map.set(id, id);
  }
  return map;
}

/** Load a payout + its source duty/attendance for the breakdown widget. */
async function loadPayoutDetail(
  payout: JsonRow,
  ctx: PayoutServiceContext
): Promise<ApiResult<PayoutDetail>> {
  const employeeId = String(payout.employee_id || "");
  const period = String(payout.period_month || "");
  const nameMap = await hydrateEmployeeNames(employeeId ? [employeeId] : [], ctx);
  const employeeName = nameMap.get(employeeId) || employeeId;

  if (!employeeId || !period) {
    return success({
      payout: { ...payout, employee_name: employeeName },
      duties: [],
      attendance: [],
      breakdown: [],
      paid_transactions: [],
      paid_total: 0,
      outstanding: Math.max(0, Number(payout.net_amount || 0)),
      employee_name: employeeName
    });
  }

  const access = dbAccess(ctx);
  const { startISO, endISO } = monthRangeUTC(period);

  const [duties, attendance, paidTx] = await Promise.all([
    dutyRepository.list(
      { employeeId, from: startISO, to: endISO, limit: 500, offset: 0 },
      access
    ),
    attendanceRepository.listForEmployeeMonth(employeeId, startISO, endISO, access),
    payoutRepository.listPaidTransactionsByPayout(String(payout.id || ""), access)
  ]);
  if (!duties.success) return passFailure(duties);
  if (!attendance.success) return passFailure(attendance);
  if (!paidTx.success) return passFailure(paidTx);

  const dutyRows = duties.data?.rows || [];
  const attendanceRows = attendance.data || [];
  const paidRows = paidTx.data || [];
  const paidTotal = paidRows.reduce(
    (sum, r) => sum + Number(r.amount || 0),
    0
  );
  const outstanding = Math.max(0, Number(payout.net_amount || 0) - paidTotal);

  return success({
    payout: { ...payout, employee_name: employeeName },
    duties: dutyRows,
    attendance: attendanceRows,
    paid_transactions: paidRows,
    paid_total: Math.round(paidTotal * 100) / 100,
    outstanding: Math.round(outstanding * 100) / 100,
    employee_name: employeeName,
    breakdown: breakdownByPatient(
      dutyRows.map((d) => ({
        id: String(d.id),
        patient_id: (d.patient_id as string | null) ?? null,
        employee_id: (d.employee_id as string | null) ?? null,
        start_at: (d.start_at as string | null) ?? null,
        shift_type: (d.shift_type as string | null) ?? null,
        status: (d.status as string | null) ?? null
      })),
      attendanceRows.map((a) => ({
        duty_id: (a.duty_id as string | null) ?? null,
        employee_id: (a.employee_id as string | null) ?? null,
        hours: (a.hours as number | string | null) ?? null,
        status: (a.status as string | null) ?? null,
        check_in_at: (a.check_in_at as string | null) ?? null
      }))
    )
  });
}

/**
 * Run `hh_recompute_payout` for an (employee, period) pair, refetch the row,
 * apply any caller-supplied adjustments, and return the persisted result.
 *
 * If the RPC reports zero duties + zero hours and the caller hasn't requested
 * a `force`, refuse loudly so the UI surfaces a "no data for period" error
 * instead of silently creating a ₹0 row.
 */
async function recomputeAndPersist(
  employeeId: string,
  period: string,
  ctx: PayoutServiceContext,
  options: {
    adjustments?: Partial<{
      advance: number;
      deduction: number;
      bonus: number;
      remarks: string;
    }>;
    requireSource?: boolean;
  } = {}
): Promise<ApiResult<JsonRow>> {
  const access = dbAccess(ctx);
  const rpc = await payoutRepository.recomputeRpc(employeeId, period, access);
  if (!rpc.success) return passFailure(rpc);
  const payoutId = rpc.data?.payout_id;
  if (!payoutId) {
    return failure(
      "hh_recompute_payout returned no payout_id",
      ErrorCodes.internal,
      { employee_id: employeeId, period }
    );
  }

  if (options.requireSource ?? true) {
    const dutyCount = Number(rpc.data?.duties || 0);
    const hours = Number(rpc.data?.hours || 0);
    const sourceCheck = ensurePayoutHasSource(dutyCount, hours);
    if (!sourceCheck.success) {
      return failure(
        sourceCheck.error || "No source data for payout",
        sourceCheck.code,
        sourceCheck.details
      );
    }
  }

  const row = await payoutRepository.findById(payoutId, access);
  if (!row.success) return passFailure(row);
  if (!row.data) return notFoundFailure("Payout", payoutId);

  const adj = options.adjustments;
  if (!adj || (adj.advance === undefined && adj.deduction === undefined && adj.bonus === undefined && adj.remarks === undefined)) {
    return success(row.data);
  }

  const rowData = row.data;
  const merged = mergePayoutAdjustments(
    {
      gross_amount: rowData.gross_amount as number | string | null | undefined,
      advance: rowData.advance as number | string | null | undefined,
      deduction: rowData.deduction as number | string | null | undefined,
      bonus: rowData.bonus as number | string | null | undefined,
      remarks: (rowData.remarks as string | null) ?? ""
    },
    adj
  );
  const sanity = validatePayoutAmounts(
    Number(rowData.gross_amount || 0),
    merged.advance,
    merged.deduction,
    merged.bonus
  );
  if (!sanity.success) {
    return failure(sanity.error || "Invalid amounts", sanity.code, sanity.details);
  }

  const patch = {
    advance: merged.advance,
    deduction: merged.deduction,
    bonus: merged.bonus,
    remarks: merged.remarks,
    net_amount: merged.net_amount,
    updated_by: ctx.actor.email
  };
  const updated = await payoutRepository.update(payoutId, patch, access);
  if (!updated.success) return passFailure(updated);

  const fresh = await loadFreshPayout(payoutId, ctx, updated.data ?? null);
  if (!fresh.success) {
    return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
  }
  return success(fresh.data);
}

export const payoutService = {
  // ─────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────

  async list(
    rawQuery: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<{ rows: JsonRow[]; total: number }>> {
    const parsed = parseInput(payoutListQuerySchema, rawQuery);
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PayoutListQuery;

    const result = await payoutRepository.list(
      {
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        employeeId: query.employee_id,
        status: query.status,
        period: query.period
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);
    const rows = result.data?.rows || [];
    // Hydrate display names in a single batch so the UI doesn't have to
    // join against `/lookups/employees` row-by-row.
    const names = await hydrateEmployeeNames(
      rows.map((r) => String(r.employee_id || "")),
      ctx
    );
    const hydrated = rows.map((r) => ({
      ...r,
      employee_name:
        names.get(String(r.employee_id || "")) || String(r.employee_id || "")
    }));
    return success({ rows: hydrated, total: result.data?.total ?? 0 });
  },

  async getById(id: string, ctx: PayoutServiceContext): Promise<ApiResult<PayoutDetail>> {
    const loaded = await loadPayout(id, ctx);
    if (!loaded.success) {
      return failure(loaded.error || "Payout not found", loaded.code, loaded.details);
    }
    return loadPayoutDetail(loaded.data, ctx);
  },

  /** Lookup by natural key (employee + period) — used by duty / attendance services. */
  async getByEmployeePeriod(
    employeeId: string,
    period: string,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow | null>> {
    return payoutRepository.findByEmployeePeriod(employeeId, period, dbAccess(ctx));
  },

  /**
   * Period-scoped "pending payout" for an employee — sourced directly from
   * the duty calendar (`hh_payout_charges`) minus disbursements already
   * recorded in `hh_paid_transactions`. Works even before an `hh_payouts`
   * row exists, so the duty calendar can render the pending pill before
   * the accountant clicks "Ensure payout".
   *
   * Also returns the persisted `hh_payouts` row (if any), the list of
   * disbursements for the period, and the employee name so the UI can
   * render the panel with one round-trip.
   */
  async pendingForEmployeePeriod(
    rawQuery: unknown,
    ctx: PayoutServiceContext
  ): Promise<
    ApiResult<{
      employee_id: string;
      employee_name: string;
      period: string;
      charged: number;
      paid: number;
      pending: number;
      duty_count: number;
      payout: JsonRow | null;
      paid_transactions: JsonRow[];
    }>
  > {
    const parsed = parseInput(payoutPendingQuerySchema, rawQuery);
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PayoutPendingQuery;
    const access = dbAccess(ctx);

    const [rpc, existing, paidTx, nameMap] = await Promise.all([
      payoutRepository.pendingPayoutRpc(query.employee_id, query.period, access),
      payoutRepository.findByEmployeePeriod(query.employee_id, query.period, access),
      payoutRepository.listPaidTransactionsByEmployeePeriod(
        query.employee_id,
        query.period,
        access
      ),
      hydrateEmployeeNames([query.employee_id], ctx)
    ]);
    if (!rpc.success) return passFailure(rpc);
    if (!existing.success) return passFailure(existing);
    if (!paidTx.success) return passFailure(paidTx);

    const data = rpc.data || {
      employee_id: query.employee_id,
      period_month: query.period,
      charged: 0,
      paid: 0,
      pending: 0,
      duty_count: 0
    };
    return success({
      employee_id: query.employee_id,
      employee_name: nameMap.get(query.employee_id) || query.employee_id,
      period: query.period,
      charged: Number(data.charged || 0),
      paid: Number(data.paid || 0),
      pending: Number(data.pending || 0),
      duty_count: Number(data.duty_count || 0),
      payout: existing.data ?? null,
      paid_transactions: paidTx.data || []
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  // Writes
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Idempotent "ensure" — runs `hh_recompute_payout` and applies caller
   * adjustments. Returns the persisted row. Duplicate prevention is enforced
   * by the DB unique constraint via `recomputeRpc` which upserts.
   */
  async ensure(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutInput;

    // Surface early if the same employee+period row is locked.
    const existing = await payoutRepository.findByEmployeePeriod(
      input.employee_id,
      input.period_month,
      dbAccess(ctx)
    );
    if (!existing.success) return passFailure(existing);
    if (existing.data) {
      const editGuard = canEditPayout(String(existing.data.status || ""));
      if (!editGuard.success) {
        return failure(
          editGuard.error || "Payout is locked",
          editGuard.code,
          editGuard.details
        );
      }
    }

    const persisted = await recomputeAndPersist(input.employee_id, input.period_month, ctx, {
      adjustments: {
        advance: input.advance,
        deduction: input.deduction,
        bonus: input.bonus,
        remarks: input.remarks
      },
      requireSource: false // ensure-only path may run before duties have hours
    });
    if (!persisted.success) {
      const msg = (persisted.error || "").toLowerCase();
      if (msg.includes("hh_payouts_unique") || msg.includes("duplicate key value")) {
        return duplicateFailure(
          "employee_period",
          `${input.employee_id}|${input.period_month}`,
          "Payout already exists for this employee + period"
        );
      }
      return passFailure(persisted);
    }

    const persistedData = persisted.data as JsonRow;
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: String(persistedData.id),
        action: existing.data ? "update" : "create",
        before: existing.data ?? null,
        after: persistedData,
        stamp: `Recompute + ensure for ${input.employee_id} ${input.period_month}`
      }),
      persistedData
    );
  },

  /** Recompute an existing payout from duty + attendance. Idempotent. */
  async recompute(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutRecomputeSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutRecomputeInput;

    // Guard: don't recompute a PAID row (would change a settled amount).
    const existing = await payoutRepository.findByEmployeePeriod(
      input.employee_id,
      input.period_month,
      dbAccess(ctx)
    );
    if (!existing.success) return passFailure(existing);
    if (existing.data && String(existing.data.status || "") === "PAID") {
      return failure(
        "Cannot recompute a PAID payout",
        ErrorCodes.business,
        { status: existing.data.status }
      );
    }

    const result = await recomputeAndPersist(input.employee_id, input.period_month, ctx, {
      requireSource: true
    });
    if (!result.success) return passFailure(result);

    const resultData = result.data as JsonRow;
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: String(resultData.id),
        action: "update",
        before: existing.data ?? null,
        after: resultData,
        stamp: `Recompute requested`
      }),
      resultData
    );
  },

  /**
   * Apply advance / deduction / bonus / remarks adjustments to an existing
   * payout. Refuses on LOCKED or PAID rows; recomputes `net_amount`.
   */
  async adjust(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutAdjustmentSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutAdjustmentInput;

    const existing = await loadPayout(input.payout_id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const editGuard = canEditPayout(String(existing.data.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Cannot adjust payout",
        editGuard.code,
        editGuard.details
      );
    }

    const stale = assertNotStale(
      "Payout",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!stale.success) return passFailure(stale);

    const existingData = existing.data;
    const merged = mergePayoutAdjustments(
      {
        gross_amount: existingData.gross_amount as number | string | null | undefined,
        advance: existingData.advance as number | string | null | undefined,
        deduction: existingData.deduction as number | string | null | undefined,
        bonus: existingData.bonus as number | string | null | undefined,
        remarks: (existingData.remarks as string | null) ?? ""
      },
      input
    );
    const sanity = validatePayoutAmounts(
      Number(existingData.gross_amount || 0),
      merged.advance,
      merged.deduction,
      merged.bonus
    );
    if (!sanity.success) {
      return failure(sanity.error || "Invalid amounts", sanity.code, sanity.details);
    }

    const patch = {
      advance: merged.advance,
      deduction: merged.deduction,
      bonus: merged.bonus,
      remarks: merged.remarks,
      net_amount: merged.net_amount,
      updated_by: ctx.actor.email
    };
    const updated = await payoutRepository.update(input.payout_id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPayout(input.payout_id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: input.payout_id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: "Adjust advance/deduction/bonus"
      }),
      fresh.data
    );
  },

  /** Lock a payout — blocks further adjustments until reopen. */
  async lock(
    id: string,
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const existing = await loadPayout(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const parsed = parseInput(payoutLockSchema, rawInput ?? {});
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutLockInput;

    const transition = canPayoutTransitionTo(String(existing.data.status || ""), "LOCKED");
    if (!transition.success) {
      return failure(
        transition.error || "Illegal status transition",
        transition.code,
        transition.details
      );
    }
    const lockGuard = canLockPayout(
      String(existing.data.status || ""),
      Number(existing.data.net_amount || 0),
      Number(existing.data.duty_count || 0)
    );
    if (!lockGuard.success) {
      return failure(lockGuard.error || "Cannot lock payout", lockGuard.code, lockGuard.details);
    }

    const patch = payoutLockRow(ctx.actor.email, input.reason);
    const updated = await payoutRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPayout(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "close",
        before: existing.data,
        after: fresh.data,
        stamp: `Closed (locked)${input.reason ? `: ${input.reason}` : ""}`
      }),
      fresh.data
    );
  },

  /** Reopen a LOCKED payout. Requires an audited reason. */
  async reopen(
    id: string,
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const existing = await loadPayout(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const parsed = parseInput(payoutReopenSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutReopenInput;

    const guard = canReopenPayout(String(existing.data.status || ""));
    if (!guard.success) {
      return failure(guard.error || "Cannot reopen payout", guard.code, guard.details);
    }

    const patch = payoutReopenRow(ctx.actor.email, input.reason);
    const updated = await payoutRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPayout(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: `Reopened: ${input.reason}`
      }),
      fresh.data
    );
  },

  /**
   * Record the FINAL disbursement against a payout. Flips the payout to
   * PAID once total disbursements settle the net amount.
   *
   * Each call creates a fresh `hh_paid_transactions` row with a unique
   * `PTXYYYY######` serial allocated by `hh_next_paid_tx_serial()` — so a
   * payout that was partially advanced has BOTH rows visible in audit
   * (advance + final).
   *
   * `amount` is optional: if omitted, the service settles the remaining
   * outstanding (net_amount − previously paid). `proof_bucket`/`proof_path`
   * point at a previously-uploaded file in the `payout-proofs` Storage
   * bucket and are mandatory for audit hygiene (the API rejects calls
   * without them on a non-zero amount).
   */
  async markPaid(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutPaySchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutPayInput;

    const existing = await loadPayout(input.payout_id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const guard = canMarkPayoutPaid(String(existing.data.status || ""));
    if (!guard.success) {
      return failure(guard.error || "Cannot mark paid", guard.code, guard.details);
    }
    const transition = canPayoutTransitionTo(String(existing.data.status || ""), "PAID");
    if (!transition.success) {
      return failure(transition.error || "Illegal transition", transition.code, transition.details);
    }

    const access = dbAccess(ctx);
    const priorTx = await payoutRepository.listPaidTransactionsByPayout(
      input.payout_id,
      access
    );
    if (!priorTx.success) return passFailure(priorTx);
    const paidSoFar = (priorTx.data || []).reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );
    const netAmount = Number(existing.data.net_amount || 0);
    const remaining = Math.max(0, netAmount - paidSoFar);
    const requestedAmount =
      input.amount !== undefined ? Number(input.amount) : remaining;

    if (requestedAmount <= 0) {
      return failure(
        "Payout has no outstanding balance — nothing to pay",
        ErrorCodes.business,
        { net_amount: netAmount, paid_so_far: paidSoFar }
      );
    }

    const guardAmount = ensureWithinPayoutOutstanding(
      netAmount,
      paidSoFar,
      requestedAmount
    );
    if (!guardAmount.success) {
      return failure(
        guardAmount.error || "Amount exceeds outstanding",
        guardAmount.code,
        guardAmount.details
      );
    }

    if (requestedAmount > 0 && !input.proof_bucket && !input.proof_path && !input.photo) {
      return failure(
        "Payout proof is required — upload a receipt/photo before marking paid",
        ErrorCodes.business
      );
    }

    const paidOnISO = input.paid_on || new Date().toISOString();
    const paidOnDay = paidOnISO.slice(0, 10);

    const serial = await payoutRepository.nextPaidTxSerialRpc(access);
    if (!serial.success) return passFailure(serial);
    const serialNo = String(serial.data || "");

    const paidTxRow = {
      id: newId.paidTx(),
      serial_no: serialNo,
      payout_id: input.payout_id,
      tx_kind: "FINAL" as const,
      partner: existing.data.employee_id,
      employee_id: existing.data.employee_id,
      period_month: existing.data.period_month,
      paid_on: paidOnDay,
      amount: Number(requestedAmount),
      method: input.method || "",
      photo: input.photo || "",
      proof_bucket: input.proof_bucket || null,
      proof_path: input.proof_path || null,
      remarks: input.remarks || "",
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };
    const paidTx = await payoutRepository.insertPaidTransaction(paidTxRow, access);
    if (!paidTx.success) return passFailure(paidTx);

    // Flip the payout to PAID only when total disbursements settle the net.
    const newPaidTotal = paidSoFar + Number(requestedAmount);
    if (isPayoutFullyPaid(netAmount, newPaidTotal)) {
      const patch = payoutPaidRow(ctx.actor.email, paidOnISO);
      const updated = await payoutRepository.update(input.payout_id, patch, access);
      if (!updated.success) return passFailure(updated);
    } else {
      // Refresh updated_by/at on the payout even on partial settle.
      const updated = await payoutRepository.update(
        input.payout_id,
        { updated_by: ctx.actor.email },
        access
      );
      if (!updated.success) return passFailure(updated);
    }

    const fresh = await loadFreshPayout(input.payout_id, ctx);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: input.payout_id,
        action: "update",
        before: existing.data,
        after: { payout: fresh.data, paid_tx: paidTxRow },
        stamp: isPayoutFullyPaid(netAmount, newPaidTotal)
          ? `Marked PAID (${serialNo}, ₹${requestedAmount.toFixed(2)})`
          : `Final disbursement ${serialNo} ₹${requestedAmount.toFixed(2)} — partial settle pending`
      }),
      fresh.data
    );
  },

  /**
   * Record an ADVANCE disbursement against an OPEN payout. Unlike
   * `markPaid`, this does NOT flip the payout to PAID — the payout stays
   * in workflow so the accountant can keep recompiling charges, then issue
   * the final disbursement later.
   *
   * Mirrors `markPaid` for amount validation, proof requirement, and
   * serial allocation.
   */
  async payAdvance(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutAdvanceSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutAdvanceInput;

    const existing = await loadPayout(input.payout_id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const guard = canPayAdvance(String(existing.data.status || ""));
    if (!guard.success) {
      return failure(guard.error || "Cannot pay advance", guard.code, guard.details);
    }

    const access = dbAccess(ctx);
    const priorTx = await payoutRepository.listPaidTransactionsByPayout(
      input.payout_id,
      access
    );
    if (!priorTx.success) return passFailure(priorTx);
    const paidSoFar = (priorTx.data || []).reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );
    const netAmount = Number(existing.data.net_amount || 0);
    const guardAmount = ensureWithinPayoutOutstanding(
      netAmount,
      paidSoFar,
      Number(input.amount)
    );
    if (!guardAmount.success) {
      return failure(
        guardAmount.error || "Amount exceeds outstanding",
        guardAmount.code,
        guardAmount.details
      );
    }

    if (!input.proof_bucket && !input.proof_path && !input.photo) {
      return failure(
        "Payout proof is required — upload a receipt/photo before paying advance",
        ErrorCodes.business
      );
    }

    const serial = await payoutRepository.nextPaidTxSerialRpc(access);
    if (!serial.success) return passFailure(serial);
    const serialNo = String(serial.data || "");

    const paidOnISO = input.paid_on || new Date().toISOString();
    const paidTxRow = {
      id: newId.paidTx(),
      serial_no: serialNo,
      payout_id: input.payout_id,
      tx_kind: "ADVANCE" as const,
      partner: existing.data.employee_id,
      employee_id: existing.data.employee_id,
      period_month: existing.data.period_month,
      paid_on: paidOnISO.slice(0, 10),
      amount: Number(input.amount),
      method: input.method || "",
      photo: input.photo || "",
      proof_bucket: input.proof_bucket || null,
      proof_path: input.proof_path || null,
      remarks: input.remarks || "",
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };
    const paidTx = await payoutRepository.insertPaidTransaction(paidTxRow, access);
    if (!paidTx.success) return passFailure(paidTx);

    // Refresh updated_by/at on the payout so list views reflect the change.
    const touched = await payoutRepository.update(
      input.payout_id,
      { updated_by: ctx.actor.email },
      access
    );
    if (!touched.success) return passFailure(touched);

    const fresh = await loadFreshPayout(input.payout_id, ctx);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: input.payout_id,
        action: "update",
        before: existing.data,
        after: { payout: fresh.data, paid_tx: paidTxRow },
        stamp: `Advance disbursement ${serialNo} ₹${Number(input.amount).toFixed(2)}`
      }),
      fresh.data
    );
  },

  /**
   * Replace the entire `hh_payout_charges` slice for a `svc_key`. Used by
   * the legacy duty-diary save to keep per-partner payout rows in sync with
   * the visible service-entries table. Audited.
   */
  async replacePayoutCharges(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<{ svc_key: string; count: number }>> {
    const parsed = parseInput(replacePayoutChargesSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as ReplacePayoutChargesInput;

    const rows: JsonRow[] = input.rows.map((row) => ({
      date: row.date || "",
      partner: row.partner || "",
      partner_id: row.partner_id || "",
      term: row.term || "",
      amount: row.amount,
      remarks: row.remarks || ""
    }));

    const replaced = await payoutRepository.replacePayoutChargesRpc(
      input.svc_key,
      rows,
      dbAccess(ctx)
    );
    if (!replaced.success) return passFailure(replaced);

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: input.svc_key,
        action: "update",
        after: { svc_key: input.svc_key, count: rows.length },
        stamp: `Replaced ${rows.length} payout charges for ${input.svc_key}`
      }),
      { svc_key: input.svc_key, count: rows.length }
    );
  },

  // ─────────────────────────────────────────────────────────────────────
  // Sync hooks (called by duty / attendance services)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Recompute by raw natural key — bypasses validation so duty / attendance
   * services can call it cheaply from their own audit-wrapped flows.
   *
   * Returns success even if the row doesn't exist yet (the RPC will upsert).
   * Refuses to touch PAID rows.
   */
  async recomputeForEmployeePeriod(
    employeeId: string,
    period: string,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow | null>> {
    if (!employeeId || !period) return success(null);
    const existing = await payoutRepository.findByEmployeePeriod(employeeId, period, dbAccess(ctx));
    if (existing.success && existing.data && String(existing.data.status || "") === "PAID") {
      return success(existing.data);
    }
    const result = await recomputeAndPersist(employeeId, period, ctx, { requireSource: false });
    if (!result.success) return passFailure(result);
    return success(result.data as JsonRow);
  },

  // ─────────────────────────────────────────────────────────────────────
  // Report parity
  // ─────────────────────────────────────────────────────────────────────

  async monthlyTotal(
    period: string,
    ctx: PayoutServiceContext
  ): Promise<
    ApiResult<{
      period: string;
      totals: PayoutTotals;
      rowCount: number;
    }>
  > {
    const result = await payoutRepository.sumNetForPeriod(period, dbAccess(ctx));
    if (!result.success) return passFailure(result);
    const rows = result.data?.rows || [];
    return success({
      period,
      totals: sumPayoutTotals(rows),
      rowCount: rows.length
    });
  },

  /** Convenience helper used by tests + UI — same net the service stores. */
  computeNet(row: JsonRow): number {
    return computePayoutNet(
      row.gross_amount as number | string | null | undefined,
      row.advance as number | string | null | undefined,
      row.deduction as number | string | null | undefined,
      row.bonus as number | string | null | undefined
    );
  }
};

export type { PayoutTotals };

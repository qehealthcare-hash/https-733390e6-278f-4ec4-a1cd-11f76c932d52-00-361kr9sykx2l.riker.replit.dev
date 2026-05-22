/**
 * Patient service — corporate-grade layered facade (Phase 5).
 *
 * Composes /src/validation/patientValidation + /src/business/patientRules +
 * /src/database/patientRepository + /src/database/employeeRepository +
 * /src/database/auditRepository.
 *
 * Rules:
 *   - Name, mobile, location, status validated server-side.
 *   - One Active patient per phone (suffix match + DB constraint if any).
 *   - DELETE is a soft-close (`status = Closed`) — historical duties/billings
 *     remain linked.
 *   - Caretaker assignment validates the employee exists and patient is Active.
 *   - History bundle is assembled from DB only (no local-only state).
 *   - Every mutation refetches the row + writes an audit log.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import {
  patientSchema,
  patientAssignSchema,
  patientListQuerySchema,
  type PatientInput,
  type PatientAssignInput,
  type PatientListQuery
} from "@/validation/patientValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  canAssignCaretaker,
  canEditPatient,
  findActivePatientDuplicate,
  patientAssignPatch,
  patientClosePatch,
  patientToApi,
  patientToRow
} from "@/business/patientRules";
import { phoneSuffix } from "@/business/phoneRules";
import { newId } from "@/business/idRules";
import { patientRepository } from "@/database/patientRepository";
import { employeeRepository } from "@/database/employeeRepository";
import { auditRepository } from "@/database/auditRepository";
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

export interface PatientServiceContext {
  actor: ActorLike;
  accessToken?: string;
}

function dbAccess(ctx: PatientServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function fireAudit(
  ctx: PatientServiceContext,
  payload: {
    entity_id: string;
    action: "create" | "update" | "delete" | string;
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
): Promise<void> {
  await auditRepository.insert(
    {
      module: "patient",
      entity_id: payload.entity_id,
      action: payload.action,
      actor: ctx.actor.email || "system",
      stamp: payload.stamp,
      before: payload.before ?? null,
      after: payload.after ?? null
    },
    dbAccess(ctx)
  );
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

async function loadPatient(id: string, ctx: PatientServiceContext): Promise<LoadResult<JsonRow>> {
  const row = await patientRepository.findById(id, dbAccess(ctx));
  if (!row.success) return toLoadFailure(row);
  if (!row.data) return toLoadFailure(notFoundFailure("Patient", id));
  return { success: true, data: row.data };
}

async function loadFreshPatient(
  id: string,
  ctx: PatientServiceContext,
  fallback?: JsonRow | null
): Promise<LoadResult<JsonRow>> {
  const refreshed = await patientRepository.findById(id, dbAccess(ctx));
  if (!refreshed.success) return toLoadFailure(refreshed);
  const row = refreshed.data ?? fallback ?? null;
  if (!row) return toLoadFailure(failure("Patient not found after mutation", ErrorCodes.internal));
  return { success: true, data: row };
}

async function ensureNoActiveDuplicate(
  phone: string,
  excludeId: string | undefined,
  ctx: PatientServiceContext
): Promise<ApiResult<null>> {
  if (!phone) return success(null);
  const candidates = await patientRepository.findActiveByPhoneSuffix(phone, excludeId, dbAccess(ctx));
  if (!candidates.success) return passFailure(candidates);
  const mapped = (candidates.data || []).map((r) => ({
    id: String(r.id),
    phone: (r.phone as string | null) ?? null,
    status: (r.status as string | null) ?? null
  }));
  const hit = findActivePatientDuplicate(mapped, phone, excludeId);
  if (hit) {
    return duplicateFailure("phone", phone, "An active patient already exists for this mobile");
  }
  return success(null);
}

export const patientService = {
  async list(
    rawQuery: unknown,
    ctx: PatientServiceContext
  ): Promise<ApiResult<{ rows: ReturnType<typeof patientToApi>[]; total: number }>> {
    const parsed = parseInput(patientListQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PatientListQuery;

    const result = await patientRepository.list(
      {
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        status: query.status,
        caretaker_id: query.caretaker_id
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);
    const rows = (result.data?.rows || []).map((r) => patientToApi(r));
    return success({ rows, total: result.data?.total ?? rows.length });
  },

  async getById(
    id: string,
    ctx: PatientServiceContext
  ): Promise<ApiResult<ReturnType<typeof patientToApi>>> {
    const loaded = await loadPatient(id, ctx);
    if (!loaded.success) {
      return failure(loaded.error || "Patient not found", loaded.code, loaded.details);
    }
    return success(patientToApi(loaded.data));
  },

  async create(
    rawInput: unknown,
    ctx: PatientServiceContext
  ): Promise<ApiResult<ReturnType<typeof patientToApi>>> {
    const parsed = parseInput(patientSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PatientInput;

    if (input.phone) {
      const dupCheck = await ensureNoActiveDuplicate(input.phone, undefined, ctx);
      if (!dupCheck.success) return passFailure(dupCheck);
    }

    const id = input.id || newId.patient();
    const row = {
      ...patientToRow(input),
      id,
      created: new Date().toISOString(),
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };
    const inserted = await patientRepository.insert(row, dbAccess(ctx));
    if (!inserted.success) return passFailure(inserted);

    const fresh = await loadFreshPatient(id, ctx, inserted.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    await fireAudit(ctx, {
      entity_id: id,
      action: "create",
      after: fresh.data,
      stamp: `Created patient ${input.name} (${phoneSuffix(input.phone)})`
    });
    return success(patientToApi(fresh.data));
  },

  async update(
    id: string,
    rawInput: unknown,
    ctx: PatientServiceContext
  ): Promise<ApiResult<ReturnType<typeof patientToApi>>> {
    const existing = await loadPatient(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Patient not found", existing.code, existing.details);
    }

    const editGuard = canEditPatient(String(existing.data.status || ""));
    if (!editGuard.success) {
      return failure(editGuard.error || "Cannot edit patient", editGuard.code, editGuard.details);
    }

    const parsed = parseInput(patientSchema, { ...(rawInput as Record<string, unknown>), id });
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PatientInput;

    const prevPhone = String(existing.data.phone || "");
    if (input.phone && input.phone !== prevPhone) {
      const dupCheck = await ensureNoActiveDuplicate(input.phone, id, ctx);
      if (!dupCheck.success) return passFailure(dupCheck);
    }

    const patch = { ...patientToRow(input), updated_by: ctx.actor.email };
    const updated = await patientRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPatient(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    await fireAudit(ctx, {
      entity_id: id,
      action: "update",
      before: existing.data,
      after: fresh.data,
      stamp: `Updated patient ${id}`
    });
    return success(patientToApi(fresh.data));
  },

  /** Soft-close: sets `status = Closed` (preserves duties / billings / receipts). */
  async remove(
    id: string,
    ctx: PatientServiceContext
  ): Promise<ApiResult<ReturnType<typeof patientToApi>>> {
    const existing = await loadPatient(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Patient not found", existing.code, existing.details);
    }

    const patch = patientClosePatch(ctx.actor.email);
    const updated = await patientRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPatient(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    await fireAudit(ctx, {
      entity_id: id,
      action: "delete",
      before: existing.data,
      after: fresh.data,
      stamp: `Closed patient ${id}`
    });
    return success(patientToApi(fresh.data));
  },

  async assignCaretaker(
    id: string,
    rawInput: unknown,
    ctx: PatientServiceContext
  ): Promise<ApiResult<ReturnType<typeof patientToApi>>> {
    const parsed = parseInput(patientAssignSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PatientAssignInput;

    const existing = await loadPatient(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Patient not found", existing.code, existing.details);
    }

    const assignGuard = canAssignCaretaker(String(existing.data.status || ""));
    if (!assignGuard.success) {
      return failure(assignGuard.error || "Cannot assign", assignGuard.code, assignGuard.details);
    }

    const employee = await employeeRepository.findById(input.caretaker_id, dbAccess(ctx));
    if (!employee.success) return passFailure(employee);
    if (!employee.data) return notFoundFailure("Caretaker", input.caretaker_id);

    const patch = patientAssignPatch(input.caretaker_id, input.shift, ctx.actor.email);
    const updated = await patientRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPatient(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    await fireAudit(ctx, {
      entity_id: id,
      action: "update",
      before: existing.data,
      after: fresh.data,
      stamp: `Assigned caretaker ${input.caretaker_id} (${input.shift})`
    });
    return success(patientToApi(fresh.data));
  },

  /**
   * Patient ledger: billings, duties, receipts (scoped to patient's billings),
   * and audit trail — all from DB.
   */
  async history(
    id: string,
    ctx: PatientServiceContext
  ): Promise<
    ApiResult<{
      patient: ReturnType<typeof patientToApi>;
      billings: JsonRow[];
      receipts: JsonRow[];
      duties: JsonRow[];
      audits: JsonRow[];
      linkCounts: { billings: number; duties: number };
    }>
  > {
    const loaded = await loadPatient(id, ctx);
    if (!loaded.success) {
      return failure(loaded.error || "Patient not found", loaded.code, loaded.details);
    }

    const access = dbAccess(ctx);
    const [billings, duties, audits, billingCount, dutyCount] = await Promise.all([
      patientRepository.listHistoryBillings(id, access),
      patientRepository.listHistoryDuties(id, access),
      patientRepository.listHistoryAudits(id, access),
      patientRepository.countBillings(id, access),
      patientRepository.countDuties(id, access)
    ]);
    if (!billings.success) return passFailure(billings);
    if (!duties.success) return passFailure(duties);
    if (!audits.success) return passFailure(audits);

    const billingRows = billings.data || [];
    const billingIds = billingRows.map((b) => String(b.id));
    const receipts = await patientRepository.listReceiptsForBillings(billingIds, access);
    if (!receipts.success) return passFailure(receipts);

    return success({
      patient: patientToApi(loaded.data),
      billings: billingRows,
      receipts: receipts.data || [],
      duties: duties.data || [],
      audits: audits.data || [],
      linkCounts: {
        billings: billingCount.success ? (billingCount.data ?? 0) : billingRows.length,
        duties: dutyCount.success ? (dutyCount.data ?? 0) : (duties.data || []).length
      }
    });
  }
};

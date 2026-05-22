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
  patientLegacySyncSchema,
  type PatientInput,
  type PatientAssignInput,
  type PatientListQuery,
  type PatientLegacySyncInput
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
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
import { auditRepository } from "@/database/auditRepository";
import type { JsonRow } from "@/database/types";
import {
  duplicateFailure,
  failure,
  notFoundFailure,
  passFailure,
  success
} from "@/utils/apiResponse";

import type { ServiceActor } from "@/types/serviceActor";

export type { ServiceActor as ActorLike };

export interface PatientServiceContext {
  actor: ServiceActor;
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
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module: "patient",
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
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "create",
        after: fresh.data,
        stamp: `Created patient ${input.name} (${phoneSuffix(input.phone)})`
      }),
      patientToApi(fresh.data)
    );
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
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: `Updated patient ${id}`
      }),
      patientToApi(fresh.data)
    );
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
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "deactivate",
        before: existing.data,
        after: fresh.data,
        stamp: `Deactivated patient ${id}`
      }),
      patientToApi(fresh.data)
    );
  },

  /**
   * Legacy SPA upsert — mirrors `sbUpsert('hh_patients', [toSbPatient(...)])`.
   *
   * - Inserts a new patient when `id` is missing OR not found.
   * - Updates a found row, preserving photo/docs on light refresh paths
   *   where the SPA omits the JSONB blobs.
   * - Refuses duplicate phone for ACTIVE patients (matches API insert path).
   * - Status uses the legacy enum (Active|Paused|Duty Closed|Expired|…).
   */
  async syncLegacy(
    rawInput: unknown,
    ctx: PatientServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(patientLegacySyncSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PatientLegacySyncInput;
    const access = dbAccess(ctx);

    let existing: JsonRow | null = null;
    if (input.id) {
      const byId = await patientRepository.findById(input.id, access);
      if (!byId.success) return passFailure(byId);
      existing = byId.data ?? null;
    }

    const wantsActive = (input.status || "Active") === "Active";
    if (wantsActive && input.phone) {
      const dup = await ensureNoActiveDuplicate(input.phone, existing?.id ? String(existing.id) : undefined, ctx);
      if (!dup.success) return passFailure(dup);
    }

    // NOTE: `hh_patients` columns are: id, name, email, phone, dob, gender,
    // blood, addr, area, city, pin, relname/relphone (x3), status, photo,
    // docs, caretaker_id, shift, created, created_at, updated_at,
    // created_by, updated_by. `status_reason`, `status_reason_other`, and
    // `address` are NOT columns — reasons live in `hh_audit_logs`.
    const baseRow: JsonRow = {
      name: input.name,
      email: input.email || "",
      phone: input.phone || "",
      dob: input.dob || "",
      gender: input.gender || "",
      blood: input.blood || "",
      addr: input.addr || input.address || "",
      area: input.area || "",
      city: input.city || "",
      pin: input.pin || "",
      relname: input.relname || "",
      relphone: input.relphone || "",
      relname2: input.relname2 || "",
      relphone2: input.relphone2 || "",
      relname3: input.relname3 || "",
      relphone3: input.relphone3 || "",
      status: input.status || "Active",
      updated_by: ctx.actor.email
    };

    // Only forward photo/docs when the caller actually included them
    // (a `__light` refresh omits both and we must not overwrite with null).
    if (Object.prototype.hasOwnProperty.call(input, "photo")) {
      baseRow.photo = input.photo ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "docs")) {
      baseRow.docs = Array.isArray(input.docs) ? input.docs : [];
    }

    if (!existing) {
      const insertId = input.id || newId.patient();
      const inserted = await patientRepository.insert(
        {
          ...baseRow,
          id: insertId,
          created: input.created || new Date().toISOString(),
          created_by: ctx.actor.email
        },
        access
      );
      if (!inserted.success) return passFailure(inserted);
      if (!inserted.data) return failure("Patient insert returned no row", ErrorCodes.internal);
      return finalizeWithAudit(
        await fireAudit(ctx, {
          entity_id: insertId,
          action: "create",
          after: inserted.data,
          stamp: `Legacy sync created patient ${input.name}`
        }),
        inserted.data
      );
    }

    const updated = await patientRepository.update(String(existing.id), baseRow, access);
    if (!updated.success) return passFailure(updated);
    const fresh = await loadFreshPatient(String(existing.id), ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: String(existing.id),
        action: "update",
        before: existing,
        after: fresh.data,
        stamp: `Legacy sync (${input.status || "Active"})`
      }),
      fresh.data
    );
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
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: `Assigned caretaker ${input.caretaker_id} (${input.shift})`
      }),
      patientToApi(fresh.data)
    );
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

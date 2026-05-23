/**
 * Inquiry / Lead service — corporate-grade layered facade.
 *
 * Composes /src/validation/inquiryValidation + /src/business/inquiryRules +
 * /src/database/inquiryRepository + /src/database/auditRepository.
 *
 * Hardened rules (Phase 7f):
 *   - Phone, status, follow-up date validated server-side. Follow-up dates
 *     are mandatory when `status ∈ { FollowUp, Negotiating }`.
 *   - One open inquiry per phone — duplicate detection runs against the
 *     `uq_hh_inquiries_active_phone` partial unique index.
 *   - Converted inquiries are terminal; edits go to the linked patient.
 *   - `convert` uses the `hh_convert_inquiry_to_patient` RPC which either
 *     attaches to the existing patient (matched by phone) or creates a new
 *     one in a single transaction. The service writes an audit log and
 *     refetches the inquiry so the UI can refresh.
 *   - Every mutation refetches the persisted row + writes an audit log.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import {
  inquirySchema,
  inquiryStatusSchema,
  inquiryConvertSchema,
  inquiryListQuerySchema,
  inquiryLegacySyncSchema,
  type InquiryInput,
  type InquiryStatusInput,
  type InquiryConvertInput,
  type InquiryListQuery,
  type InquiryLegacySyncInput,
  type InquiryStatus
} from "@/validation/inquiryValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  canConvertInquiry,
  canEditInquiry,
  canTransitionInquiryTo,
  findOpenInquiryDuplicate,
  inquiryClosePatch,
  inquiryConvertPatch,
  inquiryStatusPatch,
  inquiryToApi,
  inquiryToRow,
  isConvertedInquiry
} from "@/business/inquiryRules";
import { assertNotStale } from "@/business/concurrencyRules";
import { newId } from "@/business/idRules";
import { inquiryRepository } from "@/database/inquiryRepository";
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
  userId?: string;
  role?: string;
  accessToken?: string;
}

export interface InquiryServiceContext {
  actor: ActorLike;
  accessToken?: string;
}

function dbAccess(ctx: InquiryServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function fireAudit(
  ctx: InquiryServiceContext,
  payload: {
    entity_id: string;
    action: "create" | "update" | "delete" | string;
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module: "inquiry",
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

async function loadInquiry(
  id: string,
  ctx: InquiryServiceContext
): Promise<LoadResult<JsonRow>> {
  const row = await inquiryRepository.findById(id, dbAccess(ctx));
  if (!row.success) return toLoadFailure(row);
  if (!row.data) return toLoadFailure(notFoundFailure("Inquiry", id));
  return { success: true, data: row.data };
}

async function loadFreshInquiry(
  id: string,
  ctx: InquiryServiceContext,
  fallback?: JsonRow | null
): Promise<LoadResult<JsonRow>> {
  const refreshed = await inquiryRepository.findById(id, dbAccess(ctx));
  if (!refreshed.success) return toLoadFailure(refreshed);
  const row = refreshed.data ?? fallback ?? null;
  if (!row) return toLoadFailure(failure("Inquiry not found after mutation", ErrorCodes.internal));
  return { success: true, data: row };
}

async function ensurePhoneNotExistingPatient(
  phone: string,
  confirmExistingPatient: boolean | undefined,
  ctx: InquiryServiceContext
): Promise<ApiResult<null>> {
  if (!phone || confirmExistingPatient) return success(null);
  const linked = await inquiryRepository.findPatientByPhone(phone, dbAccess(ctx));
  if (!linked.success) return passFailure(linked);
  const patient = linked.data;
  if (!patient) return success(null);
  return duplicateFailure(
    "phone_existing_patient",
    phone,
    `This mobile is already registered as patient "${patient.name}" (id ${patient.id}). Confirm to continue anyway.`
  );
}

async function ensureNoActiveDuplicate(
  phone: string,
  excludeId: string | undefined,
  ctx: InquiryServiceContext
): Promise<ApiResult<null>> {
  if (!phone) return success(null);
  const dups = await inquiryRepository.findActiveByPhone(phone, excludeId, dbAccess(ctx));
  if (!dups.success) return passFailure(dups);
  const candidates = (dups.data || []).map((r) => ({
    id: String(r.id),
    phone: (r.phone as string | null) ?? null,
    status: (r.status as string | null) ?? null
  }));
  const hit = findOpenInquiryDuplicate(candidates, phone, excludeId);
  if (hit) {
    return duplicateFailure(
      "phone",
      phone,
      "An active inquiry already exists for this mobile"
    );
  }
  return success(null);
}

export const inquiryService = {
  // ─────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────

  async list(
    rawQuery: unknown,
    ctx: InquiryServiceContext
  ): Promise<ApiResult<{ rows: ReturnType<typeof inquiryToApi>[]; total: number }>> {
    const parsed = parseInput(inquiryListQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as InquiryListQuery;

    const result = await inquiryRepository.list(
      {
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        status: query.status,
        source: query.source,
        assigned_to: query.assigned_to,
        open_only: query.open_only,
        followup_from: query.followup_from,
        followup_to: query.followup_to,
        created_from: query.from,
        created_to: query.to
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);
    const rows = (result.data?.rows || []).map((r) => inquiryToApi(r));
    return success({ rows, total: result.data?.total ?? rows.length });
  },

  async getById(
    id: string,
    ctx: InquiryServiceContext
  ): Promise<ApiResult<ReturnType<typeof inquiryToApi>>> {
    const loaded = await loadInquiry(id, ctx);
    if (!loaded.success) {
      return failure(loaded.error || "Inquiry not found", loaded.code, loaded.details);
    }
    return success(inquiryToApi(loaded.data));
  },

  // ─────────────────────────────────────────────────────────────────────
  // Writes
  // ─────────────────────────────────────────────────────────────────────

  async create(
    rawInput: unknown,
    ctx: InquiryServiceContext
  ): Promise<ApiResult<ReturnType<typeof inquiryToApi>>> {
    const parsed = parseInput(inquirySchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as InquiryInput;

    const dupCheck = await ensureNoActiveDuplicate(input.phone, undefined, ctx);
    if (!dupCheck.success) return passFailure(dupCheck);

    const patientCheck = await ensurePhoneNotExistingPatient(
      input.phone,
      input.confirm_existing_patient,
      ctx
    );
    if (!patientCheck.success) return passFailure(patientCheck);

    const id = input.id || newId.inquiry();
    const row = {
      ...inquiryToRow({
        ...input,
        status: input.status || "New",
        rating_emergency: input.rating_emergency ?? 5,
        rating_flexibility: input.rating_flexibility ?? 5,
        rating_overall: input.rating_overall ?? 5
      }),
      id,
      created: new Date().toISOString(),
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };
    const inserted = await inquiryRepository.insert(row, dbAccess(ctx));
    if (!inserted.success) {
      const msg = (inserted.error || "").toLowerCase();
      if (msg.includes("uq_hh_inquiries_active_phone") || msg.includes("duplicate key value")) {
        return duplicateFailure(
          "phone",
          input.phone,
          "An active inquiry already exists for this mobile"
        );
      }
      return passFailure(inserted);
    }

    const fresh = await loadFreshInquiry(id, ctx, inserted.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "create",
        after: fresh.data,
        stamp: `Created inquiry for ${input.name} (${input.phone})`
      }),
      inquiryToApi(fresh.data)
    );
  },

  async update(
    id: string,
    rawInput: unknown,
    ctx: InquiryServiceContext
  ): Promise<ApiResult<ReturnType<typeof inquiryToApi>>> {
    const existing = await loadInquiry(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Inquiry not found", existing.code, existing.details);
    }

    const editGuard = canEditInquiry(String(existing.data.status || ""));
    if (!editGuard.success) {
      return failure(editGuard.error || "Cannot edit inquiry", editGuard.code, editGuard.details);
    }

    const parsed = parseInput(inquirySchema, { ...rawInput as Record<string, unknown>, id });
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as InquiryInput;

    const stale = assertNotStale("Inquiry", existing.data.updated_at, input.expected_updated_at);
    if (!stale.success) return passFailure(stale);

    // Phone change → re-run the active-duplicate guard, excluding this id.
    const prevPhone = (existing.data.phone as string | null) || "";
    if (input.phone && input.phone !== prevPhone) {
      const dupCheck = await ensureNoActiveDuplicate(input.phone, id, ctx);
      if (!dupCheck.success) return passFailure(dupCheck);
      const patientCheck = await ensurePhoneNotExistingPatient(
        input.phone,
        input.confirm_existing_patient,
        ctx
      );
      if (!patientCheck.success) return passFailure(patientCheck);
    }

    const merged: InquiryInput = {
      ...input,
      status: (input.status ?? String(existing.data.status || "New")) as InquiryInput["status"]
    };

    const patch = {
      ...inquiryToRow(merged),
      updated_by: ctx.actor.email
    };
    const updated = await inquiryRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) {
      const msg = (updated.error || "").toLowerCase();
      if (msg.includes("uq_hh_inquiries_active_phone")) {
        return duplicateFailure(
          "phone",
          input.phone,
          "Another active inquiry uses this mobile"
        );
      }
      return passFailure(updated);
    }

    const fresh = await loadFreshInquiry(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: `Updated inquiry ${id}`
      }),
      inquiryToApi(fresh.data)
    );
  },

  async setStatus(
    id: string,
    rawInput: unknown,
    ctx: InquiryServiceContext
  ): Promise<ApiResult<ReturnType<typeof inquiryToApi>>> {
    const parsed = parseInput(inquiryStatusSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as InquiryStatusInput;

    const existing = await loadInquiry(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Inquiry not found", existing.code, existing.details);
    }

    const transition = canTransitionInquiryTo(
      String(existing.data.status || ""),
      input.status,
      Boolean(input.reason)
    );
    if (!transition.success) {
      return failure(transition.error || "Illegal status transition", transition.code, transition.details);
    }

    // When reopening (closed → open) with a phone, make sure another active
    // inquiry isn't already on the same number.
    const wasClosed = isConvertedInquiry(existing.data.status as string | null)
      || String(existing.data.status || "") === "Closed"
      || String(existing.data.status || "") === "Lost";
    const becomingOpen = !(input.status === "Converted" || input.status === "Closed" || input.status === "Lost");
    if (wasClosed && becomingOpen) {
      const phone = String(existing.data.phone || "");
      const dupCheck = await ensureNoActiveDuplicate(phone, id, ctx);
      if (!dupCheck.success) return passFailure(dupCheck);
    }

    const patch = inquiryStatusPatch({
      status: input.status,
      reason: input.reason,
      followup_date: input.followup_date,
      actorEmail: ctx.actor.email
    });
    const updated = await inquiryRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshInquiry(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "status_change",
        before: existing.data,
        after: fresh.data,
        stamp: `Status ${existing.data.status} → ${input.status}${input.reason ? `: ${input.reason}` : ""}`
      }),
      inquiryToApi(fresh.data)
    );
  },

  /**
   * Legacy SPA upsert — mirrors `sbUpsert('hh_inquiries', [toSbInquiry(...)])`.
   * Honours client `INQ…` ids and enforces open-phone duplicate prevention.
   */
  async syncLegacy(
    rawInput: unknown,
    ctx: InquiryServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(inquiryLegacySyncSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as InquiryLegacySyncInput;
    const access = dbAccess(ctx);

    let existing: JsonRow | null = null;
    if (input.id) {
      const byId = await inquiryRepository.findById(input.id, access);
      if (!byId.success) return passFailure(byId);
      existing = byId.data ?? null;
    }

    if (!existing) {
      const dupCheck = await ensureNoActiveDuplicate(input.phone, undefined, ctx);
      if (!dupCheck.success) return passFailure(dupCheck);
    } else {
      const editGuard = canEditInquiry(String(existing.status || ""));
      if (!editGuard.success) {
        return failure(editGuard.error || "Cannot edit inquiry", editGuard.code, editGuard.details);
      }
      const prevPhone = String(existing.phone || "");
      if (input.phone && input.phone !== prevPhone) {
        const dupCheck = await ensureNoActiveDuplicate(input.phone, String(existing.id), ctx);
        if (!dupCheck.success) return passFailure(dupCheck);
      }
    }

    const rowPayload: JsonRow = {
      name: input.name,
      phone: input.phone,
      wa: input.wa || input.phone,
      age: input.age || "",
      gender: input.gender || "",
      city: input.city || "",
      area: input.area || "",
      service: input.service || "",
      source: input.source || "WHATSAPP",
      potential: input.potential || "WARM",
      rating_emergency: input.rating_emergency ?? 5,
      rating_flexibility: input.rating_flexibility ?? 5,
      rating_overall: input.rating_overall ?? 5,
      status: input.status || "New",
      assigned_to: input.assigned_to || "",
      followup_date: input.followup_date || "",
      notes: input.notes || "",
      updated_by: ctx.actor.email
    };

    if (!existing) {
      const insertId = input.id || newId.inquiry();
      const inserted = await inquiryRepository.insert(
        {
          ...rowPayload,
          id: insertId,
          created: input.created || new Date().toISOString(),
          created_by: ctx.actor.email
        },
        access
      );
      if (!inserted.success) {
        const msg = (inserted.error || "").toLowerCase();
        if (msg.includes("uq_hh_inquiries_active_phone") || msg.includes("duplicate key value")) {
          return duplicateFailure(
            "phone",
            input.phone,
            "An active inquiry already exists for this mobile"
          );
        }
        return passFailure(inserted);
      }
      if (!inserted.data) return failure("Inquiry insert returned no row", ErrorCodes.internal);
      return finalizeWithAudit(
        await fireAudit(ctx, {
          entity_id: insertId,
          action: "create",
          after: inserted.data,
          stamp: `Legacy sync created inquiry for ${input.name}`
        }),
        inserted.data
      );
    }

    const updated = await inquiryRepository.update(String(existing.id), rowPayload, access);
    if (!updated.success) {
      const msg = (updated.error || "").toLowerCase();
      if (msg.includes("uq_hh_inquiries_active_phone")) {
        return duplicateFailure(
          "phone",
          input.phone,
          "Another active inquiry uses this mobile"
        );
      }
      return passFailure(updated);
    }
    const fresh = await loadFreshInquiry(String(existing.id), ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: String(existing.id),
        action: "update",
        before: existing,
        after: fresh.data,
        stamp: `Legacy sync (${input.status || "New"})`
      }),
      fresh.data
    );
  },

  /**
   * Convert an inquiry to a patient.
   *
   * Calls the `hh_convert_inquiry_to_patient` RPC which either attaches to
   * an existing patient (matched on phone) or creates a new one. The RPC
   * is idempotent — re-calling it for an already-Converted inquiry returns
   * the same patient_id without re-creating.
   */
  async convertToPatient(
    id: string,
    rawInput: unknown,
    ctx: InquiryServiceContext
  ): Promise<
    ApiResult<{
      patient_id: string;
      inquiry_id: string;
      inquiry: ReturnType<typeof inquiryToApi>;
      alreadyConverted: boolean;
    }>
  > {
    const parsed = parseInput(inquiryConvertSchema, rawInput ?? {});
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as InquiryConvertInput;

    const existing = await loadInquiry(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Inquiry not found", existing.code, existing.details);
    }

    const alreadyConverted = isConvertedInquiry(existing.data.status as string | null);
    const phone = String(existing.data.phone || "");

    // Idempotency: re-converting just returns the existing patient.
    if (alreadyConverted) {
      const linked = await inquiryRepository.findPatientByPhone(phone, dbAccess(ctx));
      if (!linked.success) return passFailure(linked);
      const patient = linked.data;
      if (patient) {
        return success({
          patient_id: String(patient.id),
          inquiry_id: id,
          inquiry: inquiryToApi(existing.data),
          alreadyConverted: true
        });
      }
    }

    const convertGuard = canConvertInquiry(String(existing.data.status || ""), phone);
    if (!convertGuard.success && !alreadyConverted) {
      return failure(
        convertGuard.error || "Cannot convert inquiry",
        convertGuard.code,
        convertGuard.details
      );
    }

    const access = dbAccess(ctx);
    const rpc = await inquiryRepository.convertRpc(id, access);
    if (!rpc.success) return passFailure(rpc);
    const patientId = rpc.data?.patient_id;
    if (!patientId) {
      return failure(
        "hh_convert_inquiry_to_patient returned no patient_id",
        ErrorCodes.internal,
        { rpc: rpc.data }
      );
    }

    // Apply optional notes patch on top of the RPC's status flip.
    if (input.notes && input.notes.trim()) {
      await inquiryRepository.update(
        id,
        inquiryConvertPatch(ctx.actor.email, input.notes),
        access
      );
    }

    const fresh = await loadFreshInquiry(id, ctx, existing.data);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "convert",
        before: existing.data,
        after: { patient_id: patientId, inquiry: fresh.data },
        stamp: `Converted inquiry ${id} → patient ${patientId}`
      }),
      {
        patient_id: String(patientId),
        inquiry_id: id,
        inquiry: inquiryToApi(fresh.data),
        alreadyConverted: false
      }
    );
  },

  /**
   * DELETE defaults to soft-close (`status=Closed`). Pass `hard: true` (Admin)
   * to permanently remove a non-converted inquiry.
   */
  async remove(
    id: string,
    ctx: InquiryServiceContext,
    opts?: { reason?: string; hard?: boolean }
  ): Promise<ApiResult<{ id: string; mode: "soft" | "hard" }>> {
    const reason = String(opts?.reason || "").trim();
    const hard = Boolean(opts?.hard);

    const existing = await loadInquiry(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Inquiry not found", existing.code, existing.details);
    }

    if (isConvertedInquiry(existing.data.status as string | null)) {
      return failure(
        "Cannot delete a Converted inquiry — manage the linked patient instead",
        ErrorCodes.business,
        { status: existing.data.status }
      );
    }

    if (!hard) {
      const patch = inquiryClosePatch(ctx.actor.email, reason || "Closed via delete");
      const updated = await inquiryRepository.update(id, patch, dbAccess(ctx));
      if (!updated.success) return passFailure(updated);
      const fresh = await loadFreshInquiry(id, ctx, updated.data ?? null);
      if (!fresh.success) {
        return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
      }
      return finalizeWithAudit(
        await fireAudit(ctx, {
          entity_id: id,
          action: "deactivate",
          before: existing.data,
          after: fresh.data,
          stamp: reason ? `Closed inquiry — ${reason}` : `Closed inquiry ${id}`
        }),
        { id, mode: "soft" as const }
      );
    }

    const removed = await inquiryRepository.remove(id, dbAccess(ctx));
    if (!removed.success) return passFailure(removed);

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "delete",
        before: existing.data,
        stamp: reason ? `Hard delete — ${reason}` : `Hard deleted inquiry ${id}`
      }),
      { id, mode: "hard" as const }
    );
  }
};

export type { InquiryStatus };

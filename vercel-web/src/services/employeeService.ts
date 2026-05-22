/**
 * Employee service — composes validation + business + repository + audit.
 *
 * Returns `ApiResult<T>`. Routes translate to HTTP via apiResultBridge.
 *
 * Rules enforced here:
 *   - Mobile / role / shift / salary / dates validated via Zod.
 *   - Duplicate detection by phone suffix among Active employees.
 *   - DELETE prefers soft-delete (status = Inactive). Hard remove is only
 *     attempted when there are zero historical links to duties / attendance /
 *     payouts / patient assignments.
 *   - Every mutation refetches the persisted row before returning so the
 *     client never has to optimistically reconstruct state.
 *   - Every mutation writes an audit log entry.
 */

import type { ApiResult } from "@/types/common";
import {
  employeeSchema,
  employeeStatusSchema,
  employeeLegacySyncSchema,
  type EmployeeInput,
  type EmployeeStatus,
  type EmployeeStatusInput,
  type EmployeeLegacySyncInput
} from "@/validation/employeeValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  employeeToRow,
  employeeToApi,
  findActiveEmployeeDuplicate,
  ensureNoHistoricalLinks,
  isActiveEmployee,
  statusPatch,
  deactivatePatch,
  type EmployeeLinkCounts
} from "@/business/employeeRules";
import { phoneSuffix } from "@/business/phoneRules";
import { newId } from "@/business/idRules";
import { employeeRepository } from "@/database/employeeRepository";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
import type { JsonRow } from "@/database/types";
import {
  duplicateFailure,
  notFoundFailure,
  failure,
  success,
  passFailure
} from "@/utils/apiResponse";
import { ErrorCodes } from "@/types/common";

export interface EmployeeListOptions {
  limit?: number;
  offset?: number;
  q?: string;
  status?: string;
  dept?: string;
}

/** Shape compatible with `lib/api/auth.ActorContext` and `types/common.Actor`. */
export interface ActorLike {
  email: string;
  role?: string;
  accessToken?: string;
}

export interface EmployeeServiceContext {
  actor: ActorLike;
  /** Optional override; defaults to actor.accessToken if present. */
  accessToken?: string;
}

export type EmployeeApiRow = ReturnType<typeof employeeToApi>;

function dbAccess(ctx: EmployeeServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function fireAudit(
  ctx: EmployeeServiceContext,
  payload: {
    entity_id: string;
    action: "create" | "update" | "delete" | "restore" | "deactivate";
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module: "employee",
    entity_id: payload.entity_id,
    action: payload.action,
    stamp: payload.stamp,
    before: payload.before ?? null,
    after: payload.after ?? null
  });
}

interface PhoneCandidate {
  id: string;
  phone?: string | null;
  status?: string | null;
}

async function loadDuplicateCandidates(
  phone: string,
  ctx: EmployeeServiceContext
): Promise<ApiResult<PhoneCandidate[]>> {
  const suffix = phoneSuffix(phone);
  if (!suffix) return success<PhoneCandidate[]>([]);
  const result = await employeeRepository.findByPhoneSuffix(suffix, dbAccess(ctx));
  if (!result.success) return passFailure<PhoneCandidate[]>(result);
  return success<PhoneCandidate[]>(
    (result.data || []).map((r) => ({
      id: String(r.id),
      phone: (r.phone as string | null) ?? null,
      status: (r.status as string | null) ?? null
    }))
  );
}

async function collectLinkCounts(
  employeeId: string,
  ctx: EmployeeServiceContext
): Promise<ApiResult<EmployeeLinkCounts>> {
  const access = dbAccess(ctx);
  const [duties, attendance, payouts, caretakerOf] = await Promise.all([
    employeeRepository.countDuties(employeeId, access),
    employeeRepository.countAttendance(employeeId, access),
    employeeRepository.countPayouts(employeeId, access),
    employeeRepository.countCaretakerAssignments(employeeId, access)
  ]);
  for (const r of [duties, attendance, payouts, caretakerOf]) {
    if (!r.success) return passFailure<EmployeeLinkCounts>(r);
  }
  return success({
    duties: duties.data ?? 0,
    attendance: attendance.data ?? 0,
    payouts: payouts.data ?? 0,
    caretakerOf: caretakerOf.data ?? 0
  });
}

async function loadFreshRow(
  id: string,
  ctx: EmployeeServiceContext,
  fallback?: JsonRow | null
): Promise<ApiResult<JsonRow>> {
  const refetched = await employeeRepository.findById(id, dbAccess(ctx));
  if (!refetched.success) return passFailure<JsonRow>(refetched);
  const row = refetched.data ?? fallback ?? null;
  if (!row) return failure("Employee not found after mutation", ErrorCodes.internal);
  return success(row);
}

export const employeeService = {
  async list(
    opts: EmployeeListOptions,
    ctx: EmployeeServiceContext
  ): Promise<ApiResult<{ rows: EmployeeApiRow[]; total: number }>> {
    const result = await employeeRepository.list(
      {
        limit: opts.limit ?? 50,
        offset: opts.offset ?? 0,
        q: opts.q,
        status: opts.status,
        dept: opts.dept
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);
    return success({
      rows: (result.data?.rows || []).map(employeeToApi),
      total: result.data?.total ?? 0
    });
  },

  async getById(id: string, ctx: EmployeeServiceContext): Promise<ApiResult<EmployeeApiRow>> {
    const result = await employeeRepository.findById(id, dbAccess(ctx));
    if (!result.success) return passFailure(result);
    if (!result.data) return notFoundFailure("Employee", id);
    return success(employeeToApi(result.data));
  },

  async create(rawInput: unknown, ctx: EmployeeServiceContext): Promise<ApiResult<EmployeeApiRow>> {
    const parsed = parseInput(employeeSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as EmployeeInput;

    const dups = await loadDuplicateCandidates(input.phone, ctx);
    if (!dups.success || !dups.data) return passFailure(dups);
    const conflict = findActiveEmployeeDuplicate(dups.data, input.phone);
    if (conflict) {
      return duplicateFailure("mobile", input.phone, "Active employee already exists for this mobile");
    }

    const id = input.id || newId.employee();
    const row = {
      ...employeeToRow(input),
      id,
      created: new Date().toISOString(),
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };
    const inserted = await employeeRepository.insert(row, dbAccess(ctx));
    if (!inserted.success) return passFailure(inserted);

    const fresh = await loadFreshRow(id, ctx, inserted.data ?? null);
    if (!fresh.success || !fresh.data) return passFailure(fresh);

    return finalizeWithAudit(
      await fireAudit(ctx, { entity_id: id, action: "create", after: fresh.data }),
      employeeToApi(fresh.data)
    );
  },

  async update(
    id: string,
    rawInput: unknown,
    ctx: EmployeeServiceContext
  ): Promise<ApiResult<EmployeeApiRow>> {
    const existing = await employeeRepository.findById(id, dbAccess(ctx));
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Employee", id);

    const parsed = parseInput(employeeSchema, { ...(rawInput as object), id });
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as EmployeeInput;

    const previousPhone = (existing.data.phone as string | undefined) ?? "";
    if (input.phone && input.phone !== previousPhone) {
      const dups = await loadDuplicateCandidates(input.phone, ctx);
      if (!dups.success || !dups.data) return passFailure(dups);
      const conflict = findActiveEmployeeDuplicate(dups.data, input.phone, id);
      if (conflict) {
        return duplicateFailure("mobile", input.phone, "Another active employee uses this mobile");
      }
    }

    const patch = { ...employeeToRow(input), updated_by: ctx.actor.email };
    const updated = await employeeRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshRow(id, ctx, updated.data ?? null);
    if (!fresh.success || !fresh.data) return passFailure(fresh);

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data
      }),
      employeeToApi(fresh.data)
    );
  },

  async setStatus(
    id: string,
    rawInput: unknown,
    ctx: EmployeeServiceContext
  ): Promise<ApiResult<EmployeeApiRow>> {
    const existing = await employeeRepository.findById(id, dbAccess(ctx));
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Employee", id);

    const parsed = parseInput(employeeStatusSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as EmployeeStatusInput;

    const patch = statusPatch(input.status, ctx.actor.email, input.reason);
    const updated = await employeeRepository.updateStatus(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshRow(id, ctx, updated.data ?? null);
    if (!fresh.success || !fresh.data) return passFailure(fresh);

    const statusAction =
      input.status === "Active" ? "restore" : input.status === "Inactive" ? "deactivate" : "update";
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: statusAction,
        before: existing.data,
        after: fresh.data,
        stamp: `Status -> ${input.status}${input.reason ? ` (${input.reason})` : ""}`
      }),
      employeeToApi(fresh.data)
    );
  },

  /**
   * Legacy SPA upsert — mirrors `sbUpsert('hh_employees', [toSbEmployee(...)])`.
   * Honours client-generated `EMP…` ids and the full legacy column set.
   */
  async syncLegacy(
    rawInput: unknown,
    ctx: EmployeeServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(employeeLegacySyncSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as EmployeeLegacySyncInput;
    const access = dbAccess(ctx);

    let existing: JsonRow | null = null;
    if (input.id) {
      const byId = await employeeRepository.findById(input.id, access);
      if (!byId.success) return passFailure(byId);
      existing = byId.data ?? null;
    }

    const phone = String(input.phone || "").replace(/[^0-9+]/g, "");
    if (isActiveEmployee(input.status)) {
      const dups = await loadDuplicateCandidates(phone, ctx);
      if (!dups.success || !dups.data) return passFailure(dups);
      const conflict = findActiveEmployeeDuplicate(
        dups.data,
        phone,
        existing?.id ? String(existing.id) : undefined
      );
      if (conflict) {
        return duplicateFailure("mobile", phone, "Active employee already exists for this mobile");
      }
    }

    const baseRow: JsonRow = {
      fn: input.fn,
      mn: input.mn || "",
      ln: input.ln || "",
      email: input.email || "",
      phone,
      phone2: input.phone2 || "",
      gender: input.gender || "",
      dob: input.dob || "",
      blood: input.blood || "",
      dept: input.dept || "",
      etype: input.etype || "",
      desig: input.desig || "",
      emp_type: input.emp_type || "",
      edu: input.edu || "",
      join_date: input.join_date || "",
      exp: input.exp || "",
      shift: input.shift || "",
      salary: input.salary != null ? String(input.salary) : "",
      aadhar: input.aadhar || "",
      pan: input.pan || "",
      permaddr: input.permaddr || "",
      presaddr: input.presaddr || "",
      pin: input.pin || "",
      district: input.district || "",
      state: input.state || "",
      ecname: input.ecname || "",
      ecphone: input.ecphone || "",
      ecrel: input.ecrel || "",
      skills: input.skills || "",
      area: input.area || "",
      leave_date:
        (input.status || "Active") === "Inactive"
          ? input.leave_date || new Date().toISOString().slice(0, 10)
          : input.leave_date || "",
      updated_by: ctx.actor.email
    };

    // NOTE: `hh_employees` has NO `photo` column. The legacy SPA used to
    // upload a separate photo blob, but production schema stores employee
    // documents inside `docs` (jsonb) only. We accept `photo` from callers
    // but persist it as the first entry of `docs` for parity.
    let nextDocs: unknown[] | undefined;
    if (Object.prototype.hasOwnProperty.call(input, "docs")) {
      nextDocs = Array.isArray(input.docs) ? [...(input.docs as unknown[])] : [];
    }
    if (Object.prototype.hasOwnProperty.call(input, "photo") && input.photo) {
      nextDocs = nextDocs || [];
      const photoEntry =
        typeof input.photo === "object" && input.photo !== null
          ? { kind: "photo", ...(input.photo as Record<string, unknown>) }
          : { kind: "photo", value: input.photo };
      nextDocs.unshift(photoEntry);
    }
    if (nextDocs !== undefined) baseRow.docs = nextDocs;

    if (!existing) {
      const insertId = input.id || newId.employee();
      const inserted = await employeeRepository.insert(
        {
          ...baseRow,
          id: insertId,
          created: input.created || new Date().toISOString(),
          created_by: ctx.actor.email
        },
        access
      );
      if (!inserted.success) return passFailure(inserted);
      if (!inserted.data) return failure("Employee insert returned no row", ErrorCodes.internal);
      return finalizeWithAudit(
        await fireAudit(ctx, {
          entity_id: insertId,
          action: "create",
          after: inserted.data,
          stamp: `Legacy sync created employee ${input.fn}`
        }),
        inserted.data
      );
    }

    const updated = await employeeRepository.update(String(existing.id), baseRow, access);
    if (!updated.success) return passFailure(updated);
    const fresh = await loadFreshRow(String(existing.id), ctx, updated.data ?? null);
    if (!fresh.success || !fresh.data) return passFailure(fresh);
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

  deactivate(id: string, reason: string, ctx: EmployeeServiceContext): Promise<ApiResult<EmployeeApiRow>> {
    return employeeService.setStatus(id, { status: "Inactive" as EmployeeStatus, reason }, ctx);
  },

  activate(id: string, ctx: EmployeeServiceContext): Promise<ApiResult<EmployeeApiRow>> {
    return employeeService.setStatus(id, { status: "Active" as EmployeeStatus }, ctx);
  },

  /**
   * If the employee has historical links, set status = Inactive (returns `{mode: "soft"}`).
   * If no links exist, hard-delete is safe (returns `{mode: "hard"}`).
   */
  async remove(
    id: string,
    ctx: EmployeeServiceContext
  ): Promise<ApiResult<EmployeeApiRow & { mode: "soft" | "hard" }>> {
    const existing = await employeeRepository.findById(id, dbAccess(ctx));
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Employee", id);

    const counts = await collectLinkCounts(id, ctx);
    if (!counts.success || !counts.data) return passFailure(counts);

    const linkCheck = ensureNoHistoricalLinks(counts.data);
    if (!linkCheck.success) {
      const patch = deactivatePatch(ctx.actor.email, "delete requested");
      const updated = await employeeRepository.updateStatus(id, patch, dbAccess(ctx));
      if (!updated.success) return passFailure(updated);
      const fresh = await loadFreshRow(id, ctx, updated.data ?? null);
      if (!fresh.success || !fresh.data) return passFailure(fresh);
      return finalizeWithAudit(
        await fireAudit(ctx, {
          entity_id: id,
          action: "delete",
          before: existing.data,
          after: fresh.data,
          stamp: `Soft delete (links: ${JSON.stringify(counts.data)})`
        }),
        { ...employeeToApi(fresh.data), mode: "soft" as const }
      );
    }

    const removed = await employeeRepository.remove(id, dbAccess(ctx));
    if (!removed.success) return passFailure(removed);
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "delete",
        before: existing.data,
        stamp: "Hard delete (no historical links)"
      }),
      { ...employeeToApi(existing.data), mode: "hard" as const }
    );
  },

  /** Counts of historical links — used by UI to pick "delete vs deactivate". */
  linkCounts(id: string, ctx: EmployeeServiceContext): Promise<ApiResult<EmployeeLinkCounts>> {
    return collectLinkCounts(id, ctx);
  }
};

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
  buildEmployeePermissions,
  employeeToRow,
  employeeToApi,
  canEditEmployee,
  employeeNameKey,
  findActiveEmployeeDuplicate,
  findActiveEmployeeByName,
  findActiveEmployeeByAadhar,
  normalizeAadhar,
  ensureNoHistoricalLinks,
  isActiveEmployee,
  statusPatch,
  deactivatePatch,
  type EmployeeLinkCounts
} from "@/business/employeeRules";
import { assertNotStale } from "@/business/concurrencyRules";
import { phoneDigitsKey, phoneSuffix } from "@/business/phoneRules";
import { newId } from "@/business/idRules";
import { crmTodayIso } from "@/utils/crmToday";
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

import type { ServiceActor } from "@/types/serviceActor";

/** @deprecated Import `ServiceActor` from `@/types/serviceActor`. */
export type ActorLike = ServiceActor;

export interface EmployeeServiceContext {
  actor: ServiceActor;
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

async function ensureNoActiveNameDuplicate(
  input: EmployeeInput,
  excludeId: string | undefined,
  ctx: EmployeeServiceContext
): Promise<ApiResult<null>> {
  if (input.confirm_duplicate_name) return success(null);
  const key = employeeNameKey(input);
  if (!key) return success(null);

  const candidates = await employeeRepository.findActiveByName(key, excludeId, dbAccess(ctx));
  if (!candidates.success) return passFailure(candidates);
  const mapped = (candidates.data || []).map((r) => ({
    id: String(r.id),
    fn: (r.fn as string | null) ?? null,
    mn: (r.mn as string | null) ?? null,
    ln: (r.ln as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    leave_date: (r.leave_date as string | null) ?? null
  }));
  const hit = findActiveEmployeeByName(mapped, input, excludeId);
  if (!hit) return success(null);
  const hitName = employeeNameKey(hit);
  return duplicateFailure(
    "name",
    key,
    `An active employee named "${hitName}" already exists (id ${hit.id}, phone ${
      hit.phone || "—"
    }). Confirm and retry to create anyway.`
  );
}

async function ensureNoActiveAadharDuplicate(
  input: EmployeeInput,
  excludeId: string | undefined,
  ctx: EmployeeServiceContext
): Promise<ApiResult<null>> {
  if (input.confirm_duplicate_name) return success(null);
  const digits = normalizeAadhar(input.aadhar);
  if (digits.length !== 12) return success(null);

  const candidates = await employeeRepository.findActiveByAadhar(digits, excludeId, dbAccess(ctx));
  if (!candidates.success) return passFailure(candidates);
  const mapped = (candidates.data || []).map((r) => ({
    id: String(r.id),
    fn: (r.fn as string | null) ?? null,
    mn: (r.mn as string | null) ?? null,
    ln: (r.ln as string | null) ?? null,
    aadhar: (r.aadhar as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    leave_date: (r.leave_date as string | null) ?? null
  }));
  const hit = findActiveEmployeeByAadhar(mapped, digits, excludeId);
  if (!hit) return success(null);
  return duplicateFailure(
    "aadhar",
    digits,
    `An active employee already uses Aadhar ${digits} (id ${hit.id}, ${employeeNameKey(
      hit
    )}). Confirm and retry to create anyway.`
  );
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
    const apiRow = employeeToApi(result.data);
    // Decorate with server-computed action flags so the UI never re-derives
    // employee policy from status / leave_date. Link counts are skipped
    // here — the dedicated remove() flow still enforces them server-side.
    const permissions = buildEmployeePermissions({
      status: String(apiRow.status || "Active")
    });
    return success({ ...apiRow, permissions } as EmployeeApiRow);
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

    const nameCheck = await ensureNoActiveNameDuplicate(input, undefined, ctx);
    if (!nameCheck.success) return passFailure(nameCheck);

    const aadharCheck = await ensureNoActiveAadharDuplicate(input, undefined, ctx);
    if (!aadharCheck.success) return passFailure(aadharCheck);

    const id = input.id || newId.employee();
    const row = {
      ...employeeToRow({ ...input, status: input.status || "Active" }),
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

    const editGuard = canEditEmployee(existing.data as { status?: string; leave_date?: string });
    if (!editGuard.success) return passFailure(editGuard);

    const parsed = parseInput(employeeSchema, { ...(rawInput as object), id });
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as EmployeeInput;

    const stale = assertNotStale("Employee", existing.data.updated_at, input.expected_updated_at);
    if (!stale.success) return passFailure(stale);

    // Status transitions must go through POST /employees/:id/status so the
    // reason / audit / leave_date workflow is always invoked.
    const existingStatus = String(existing.data.status || "Active");
    if (input.status && input.status !== existingStatus) {
      return failure(
        `Use the Change Status action to change employee status (current: ${existingStatus})`,
        ErrorCodes.business,
        { current: existingStatus, requested: input.status }
      );
    }

    const previousPhone = (existing.data.phone as string | undefined) ?? "";
    if (input.phone && input.phone !== previousPhone) {
      const dups = await loadDuplicateCandidates(input.phone, ctx);
      if (!dups.success || !dups.data) return passFailure(dups);
      const conflict = findActiveEmployeeDuplicate(dups.data, input.phone, id);
      if (conflict) {
        return duplicateFailure("mobile", input.phone, "Another active employee uses this mobile");
      }
    }

    const merged: EmployeeInput = {
      ...input,
      status: (input.status ??
        String(existing.data.status || "Active")) as EmployeeInput["status"]
    };

    const prevNameKey = employeeNameKey(existing.data as EmployeeInput);
    const nextNameKey = employeeNameKey(merged);
    if (nextNameKey && nextNameKey !== prevNameKey) {
      const nameCheck = await ensureNoActiveNameDuplicate(merged, id, ctx);
      if (!nameCheck.success) return passFailure(nameCheck);
    }

    const prevAadhar = normalizeAadhar(String(existing.data.aadhar || ""));
    const nextAadhar = normalizeAadhar(merged.aadhar);
    if (nextAadhar.length === 12 && nextAadhar !== prevAadhar) {
      const aadharCheck = await ensureNoActiveAadharDuplicate(merged, id, ctx);
      if (!aadharCheck.success) return passFailure(aadharCheck);
    }

    const patch = { ...employeeToRow(merged), updated_by: ctx.actor.email };
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

    // When transitioning to Active we must respect the same uniqueness rules
    // that apply to create/update – Aadhar, mobile, and name. The DB enforces
    // these with partial unique indexes (status='Active'), so without this
    // preflight the user would see an opaque 500 / DB error instead of a
    // friendly explanation of who already owns the value.
    if (input.status === "Active") {
      const row = existing.data as JsonRow;
      const probe = {
        fn: (row.fn as string | null) ?? "",
        mn: (row.mn as string | null) ?? "",
        ln: (row.ln as string | null) ?? "",
        phone: (row.phone as string | null) ?? "",
        aadhar: (row.aadhar as string | null) ?? ""
      } as unknown as EmployeeInput;

      if (probe.phone) {
        const dups = await loadDuplicateCandidates(probe.phone, ctx);
        if (!dups.success) return passFailure(dups);
        const conflict = findActiveEmployeeDuplicate(dups.data || [], probe.phone, id);
        if (conflict) {
          return duplicateFailure(
            "mobile",
            probe.phone,
            `Cannot activate — another active employee (id ${conflict.id}) already uses this mobile number. Deactivate or change theirs first.`
          );
        }
      }

      const aadharCheck = await ensureNoActiveAadharDuplicate(probe, id, ctx);
      if (!aadharCheck.success) return passFailure(aadharCheck);

      const nameCheck = await ensureNoActiveNameDuplicate(probe, id, ctx);
      if (!nameCheck.success) return passFailure(nameCheck);
    }

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
    const existingId = existing?.id ? String(existing.id) : undefined;
    if (isActiveEmployee(input.status)) {
      const dups = await loadDuplicateCandidates(phone, ctx);
      if (!dups.success || !dups.data) return passFailure(dups);
      const conflict = findActiveEmployeeDuplicate(dups.data, phone, existingId);
      if (conflict) {
        return duplicateFailure("mobile", phone, "Active employee already exists for this mobile");
      }

      const nameProbe = {
        fn: input.fn || "",
        mn: input.mn || "",
        ln: input.ln || ""
      } as unknown as EmployeeInput;
      const nameCheck = await ensureNoActiveNameDuplicate(nameProbe, existingId, ctx);
      if (!nameCheck.success) return passFailure(nameCheck);

      const aadharProbe = { aadhar: input.aadhar || "" } as unknown as EmployeeInput;
      const aadharCheck = await ensureNoActiveAadharDuplicate(aadharProbe, existingId, ctx);
      if (!aadharCheck.success) return passFailure(aadharCheck);
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
          ? input.leave_date || crmTodayIso()
          : input.leave_date || "",
      name_key: employeeNameKey({ fn: input.fn, mn: input.mn, ln: input.ln }),
      phone_digits: phoneDigitsKey(phone),
      updated_by: ctx.actor.email
    };

    if (Object.prototype.hasOwnProperty.call(input, "docs")) {
      baseRow.docs = Array.isArray(input.docs) ? [...(input.docs as unknown[])] : [];
    }
    // hh_employees gained a `photo jsonb` column in migration 031. Persist the
    // structured photo object directly so the React form / PDF and the legacy
    // SPA share the same shape (the legacy client also reads `employee.photo`).
    if (Object.prototype.hasOwnProperty.call(input, "photo")) {
      const raw = (input as { photo?: unknown }).photo;
      baseRow.photo =
        raw && typeof raw === "object"
          ? (raw as Record<string, unknown>)
          : raw == null
            ? null
            : { value: raw };
    }

    if (!existing) {
      const insertId = input.id || newId.employee();
      const inserted = await employeeRepository.insert(
        {
          ...baseRow,
          id: insertId,
          created: new Date().toISOString(),
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
    ctx: EmployeeServiceContext,
    opts?: { reason?: string }
  ): Promise<ApiResult<EmployeeApiRow & { mode: "soft" | "hard" }>> {
    const reason = String(opts?.reason || "").trim();
    const existing = await employeeRepository.findById(id, dbAccess(ctx));
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Employee", id);

    const counts = await collectLinkCounts(id, ctx);
    if (!counts.success || !counts.data) return passFailure(counts);

    const linkCheck = ensureNoHistoricalLinks(counts.data);
    if (!linkCheck.success) {
      const patch = deactivatePatch(ctx.actor.email, reason || "delete requested");
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
          stamp: reason
            ? `Soft delete — ${reason} (links: ${JSON.stringify(counts.data)})`
            : `Soft delete (links: ${JSON.stringify(counts.data)})`
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
        stamp: reason ? `Hard delete — ${reason}` : "Hard delete (no historical links)"
      }),
      { ...employeeToApi(existing.data), mode: "hard" as const }
    );
  },

  /** Counts of historical links — used by UI to pick "delete vs deactivate". */
  linkCounts(id: string, ctx: EmployeeServiceContext): Promise<ApiResult<EmployeeLinkCounts>> {
    return collectLinkCounts(id, ctx);
  }
};

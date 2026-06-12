/**
 * Doctor service — orchestrates validation, business logic, and persistence
 * for `hh_doctors`. Returns ApiResult<T> from every method.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import type { ServiceContext } from "@/types/serviceActor";
import {
  failure,
  notFoundFailure,
  passFailure,
  success,
  validationFailure
} from "@/utils/apiResponse";
import type { JsonRow } from "@/database/types";
import { doctorRepository } from "@/database/doctorRepository";
import {
  doctorCreateSchema,
  doctorPatchSchema,
  type DoctorCreateInput,
  type DoctorPatchInput
} from "@/validation/doctorValidation";
import { assertNotStale, requireExpectedVersion } from "@/business/concurrencyRules";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";

const ALLOWED_FIELDS = [
  "fn",
  "ln",
  "gender",
  "phone",
  "email",
  "city",
  "aadhar",
  "pan",
  "spec",
  "qual",
  "regno",
  "regcouncil",
  "regyear",
  "clinic",
  "clinicaddr"
] as const;

interface DoctorRow extends JsonRow {
  id: string;
  fn?: string | null;
  ln?: string | null;
}

export interface DoctorListOptions {
  q?: string;
  city?: string;
  spec?: string;
  limit?: number;
  offset?: number;
}

export interface DoctorRecord extends JsonRow {
  full_name: string;
}

function buildPayload(
  input: DoctorCreateInput | DoctorPatchInput | Record<string, unknown>
): Record<string, unknown> {
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (src[key] !== undefined) {
      out[key] = typeof src[key] === "string" ? (src[key] as string).trim() : src[key];
    }
  }
  return out;
}

function fullName(row: DoctorRow): string {
  return [row.fn, row.ln].filter(Boolean).join(" ").trim();
}

function nextDoctorId(rows: { id: string }[]): string {
  let max = 0;
  rows.forEach((r) => {
    const m = String(r.id || "").match(/^DOC(\d+)$/);
    if (m) {
      const n = parseInt(m[1] || "", 10);
      if (n > max) max = n;
    }
  });
  return "DOC" + String(max + 1).padStart(5, "0");
}

function decorate(row: JsonRow | null | undefined): DoctorRecord | null {
  if (!row) return null;
  return { ...row, full_name: fullName(row as DoctorRow) };
}

export const doctorService = {
  async list(
    opts: DoctorListOptions,
    ctx: ServiceContext
  ): Promise<ApiResult<{ rows: DoctorRecord[]; total: number }>> {
    const result = await doctorRepository.list({
      accessToken: ctx.accessToken,
      q: opts.q,
      city: opts.city,
      spec: opts.spec,
      limit: opts.limit,
      offset: opts.offset
    });
    if (!result.success) return passFailure(result);
    const rows = (result.data?.rows || []).map((r) => decorate(r)!);
    return success({ rows, total: result.data?.total ?? rows.length });
  },

  async get(id: string, ctx: ServiceContext): Promise<ApiResult<DoctorRecord>> {
    const result = await doctorRepository.findById(id, { accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    const row = decorate(result.data);
    if (!row) return notFoundFailure("Doctor", id);
    return success(row);
  },

  async create(input: unknown, ctx: ServiceContext): Promise<ApiResult<DoctorRecord>> {
    const parsed = doctorCreateSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const seq = await doctorRepository.listForSequence({ accessToken: ctx.accessToken });
    if (!seq.success) return passFailure(seq);

    const row = {
      id: nextDoctorId((seq.data as { id: string }[]) || []),
      ...buildPayload(parsed.data),
      created: new Date().toISOString().slice(0, 10)
    };

    const inserted = await doctorRepository.insert(row, { accessToken: ctx.accessToken });
    if (!inserted.success) return passFailure(inserted);
    const decorated = decorate(inserted.data);
    if (!decorated) {
      return failure("Failed to create doctor", ErrorCodes.internal);
    }
    const audit = await writeMutationAudit({ accessToken: ctx.accessToken }, ctx.actor, {
      module: "doctors",
      entity_id: String(inserted.data?.id ?? row.id),
      action: "create",
      after: inserted.data,
      stamp: `Created doctor ${row.id}`
    });
    return finalizeWithAudit(audit, decorated);
  },

  async update(
    id: string,
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<DoctorRecord>> {
    const existing = await doctorRepository.findById(id, { accessToken: ctx.accessToken });
    if (!existing.success) return passFailure(existing);
    if (!existing.data) return notFoundFailure("Doctor", id);

    const parsed = doctorPatchSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const versionRequired = requireExpectedVersion("Doctor", parsed.data.expected_updated_at);
    if (!versionRequired.success) return passFailure(versionRequired);

    const stale = assertNotStale(
      "Doctor",
      existing.data.updated_at,
      parsed.data.expected_updated_at
    );
    if (!stale.success) return passFailure(stale);

    const payload = buildPayload(parsed.data);
    if (Object.keys(payload).length === 0) {
      return failure("No editable fields supplied", ErrorCodes.badRequest);
    }
    const before = existing;
    const updated = await doctorRepository.update(id, payload, { accessToken: ctx.accessToken });
    if (!updated.success) return passFailure(updated);
    const row = decorate(updated.data);
    if (!row) return notFoundFailure("Doctor", id);
    const audit = await writeMutationAudit({ accessToken: ctx.accessToken }, ctx.actor, {
      module: "doctors",
      entity_id: id,
      action: "update",
      before: before.success ? before.data ?? null : null,
      after: updated.data,
      stamp: `Updated doctor ${id}`
    });
    return finalizeWithAudit(audit, row);
  },

  async remove(id: string, ctx: ServiceContext): Promise<ApiResult<{ id: string; deleted: true }>> {
    const before = await doctorRepository.findById(id, { accessToken: ctx.accessToken });
    const removed = await doctorRepository.remove(id, { accessToken: ctx.accessToken });
    if (!removed.success) return passFailure(removed);
    const audit = await writeMutationAudit({ accessToken: ctx.accessToken }, ctx.actor, {
      module: "doctors",
      entity_id: id,
      action: "delete",
      before: before.success ? before.data ?? null : null,
      stamp: `Deleted doctor ${id}`
    });
    return finalizeWithAudit(audit, { id, deleted: true as const });
  }
};

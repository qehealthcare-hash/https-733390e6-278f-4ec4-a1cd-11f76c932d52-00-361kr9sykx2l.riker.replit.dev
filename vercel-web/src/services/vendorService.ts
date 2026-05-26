/**
 * Vendor service — orchestrates validation and persistence for `hh_vendors`.
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
import { vendorRepository } from "@/database/vendorRepository";
import {
  vendorCreateSchema,
  vendorPatchSchema,
  type VendorCreateInput,
  type VendorPatchInput
} from "@/validation/vendorValidation";

const ALLOWED_FIELDS = [
  "name",
  "contact",
  "phone",
  "email",
  "gst",
  "pan",
  "addr",
  "city"
] as const;

export interface VendorListOptions {
  q?: string;
  city?: string;
  limit?: number;
  offset?: number;
}

function buildPayload(
  input: VendorCreateInput | VendorPatchInput | Record<string, unknown>
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

function nextVendorId(rows: { id: string }[]): string {
  let max = 0;
  rows.forEach((r) => {
    const m = String(r.id || "").match(/^VEN(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return "VEN" + String(max + 1).padStart(5, "0");
}

export const vendorService = {
  async list(
    opts: VendorListOptions,
    ctx: ServiceContext
  ): Promise<ApiResult<{ rows: JsonRow[]; total: number }>> {
    const result = await vendorRepository.list({
      accessToken: ctx.accessToken,
      q: opts.q,
      city: opts.city,
      limit: opts.limit,
      offset: opts.offset
    });
    if (!result.success) return passFailure(result);
    return success({ rows: result.data?.rows || [], total: result.data?.total ?? 0 });
  },

  async get(id: string, ctx: ServiceContext): Promise<ApiResult<JsonRow>> {
    const result = await vendorRepository.findById(id, { accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    if (!result.data) return notFoundFailure("Vendor", id);
    return success(result.data);
  },

  async create(input: unknown, ctx: ServiceContext): Promise<ApiResult<JsonRow>> {
    const parsed = vendorCreateSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const seq = await vendorRepository.listForSequence({ accessToken: ctx.accessToken });
    if (!seq.success) return passFailure(seq);

    const row = {
      id: nextVendorId((seq.data as { id: string }[]) || []),
      ...buildPayload(parsed.data),
      created: new Date().toISOString().slice(0, 10)
    };

    const inserted = await vendorRepository.insert(row, { accessToken: ctx.accessToken });
    if (!inserted.success) return passFailure(inserted);
    if (!inserted.data) return failure("Failed to create vendor", ErrorCodes.internal);
    return success(inserted.data);
  },

  async update(
    id: string,
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = vendorPatchSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const payload = buildPayload(parsed.data);
    if (Object.keys(payload).length === 0) {
      return failure("No editable fields supplied", ErrorCodes.badRequest);
    }
    const updated = await vendorRepository.update(id, payload, { accessToken: ctx.accessToken });
    if (!updated.success) return passFailure(updated);
    if (!updated.data) return notFoundFailure("Vendor", id);
    return success(updated.data);
  },

  async remove(id: string, ctx: ServiceContext): Promise<ApiResult<{ id: string; deleted: true }>> {
    const removed = await vendorRepository.remove(id, { accessToken: ctx.accessToken });
    if (!removed.success) return passFailure(removed);
    return success({ id, deleted: true });
  }
};

/**
 * Settings service — key-value store backed by `hh_app_settings`.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import type { ServiceContext } from "@/types/serviceActor";
import {
  failure,
  passFailure,
  success,
  validationFailure
} from "@/utils/apiResponse";
import type { JsonRow } from "@/database/types";
import { settingsRepository } from "@/database/settingsRepository";
import {
  settingsBulkSchema,
  settingsKeySchema
} from "@/validation/settingsValidation";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";

export const settingsService = {
  async listAll(
    ctx: ServiceContext
  ): Promise<ApiResult<Record<string, unknown>>> {
    const result = await settingsRepository.listAll({ accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    const map: Record<string, unknown> = {};
    (result.data || []).forEach((row) => {
      if (row && typeof row.key === "string") map[row.key] = row.value;
    });
    return success(map);
  },

  async getKey(
    rawKey: string,
    ctx: ServiceContext
  ): Promise<ApiResult<unknown>> {
    const parsed = settingsKeySchema.safeParse(rawKey);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const result = await settingsRepository.findByKey(parsed.data, {
      accessToken: ctx.accessToken
    });
    if (!result.success) return passFailure(result);
    return success(result.data?.value ?? null);
  },

  async setKey(
    rawKey: string,
    value: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = settingsKeySchema.safeParse(rawKey);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const before = await settingsRepository.findByKey(parsed.data, {
      accessToken: ctx.accessToken
    });
    const upserted = await settingsRepository.upsert(
      { key: parsed.data, value, updated_at: new Date().toISOString() },
      { accessToken: ctx.accessToken }
    );
    if (!upserted.success) return passFailure(upserted);
    if (!upserted.data) return failure("Failed to save setting", ErrorCodes.internal);
    const audit = await writeMutationAudit({ accessToken: ctx.accessToken }, ctx.actor, {
      module: "settings",
      entity_id: parsed.data,
      action: "update",
      before: before.success ? before.data ?? null : null,
      after: upserted.data,
      stamp: `Updated setting ${parsed.data}`
    });
    return finalizeWithAudit(audit, upserted.data);
  },

  async deleteKey(
    rawKey: string,
    ctx: ServiceContext
  ): Promise<ApiResult<{ key: string; deleted: true }>> {
    const parsed = settingsKeySchema.safeParse(rawKey);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const before = await settingsRepository.findByKey(parsed.data, {
      accessToken: ctx.accessToken
    });
    const removed = await settingsRepository.remove(parsed.data, {
      accessToken: ctx.accessToken
    });
    if (!removed.success) return passFailure(removed);
    const audit = await writeMutationAudit({ accessToken: ctx.accessToken }, ctx.actor, {
      module: "settings",
      entity_id: parsed.data,
      action: "delete",
      before: before.success ? before.data ?? null : null,
      stamp: `Deleted setting ${parsed.data}`
    });
    return finalizeWithAudit(audit, { key: parsed.data, deleted: true as const });
  },

  async bulkSet(
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<Array<{ key: string; value: unknown }>>> {
    const parsed = settingsBulkSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const now = new Date().toISOString();
    const rows = Object.keys(parsed.data).map((key) => ({
      key,
      value: parsed.data[key],
      updated_at: now
    }));
    const written = await settingsRepository.upsertMany(rows, {
      accessToken: ctx.accessToken
    });
    if (!written.success) return passFailure(written);
    const audit = await writeMutationAudit({ accessToken: ctx.accessToken }, ctx.actor, {
      module: "settings",
      entity_id: null,
      action: "bulk-update",
      after: rows.map((r) => ({ key: r.key })),
      stamp: `Bulk updated ${rows.length} setting(s)`
    });
    return finalizeWithAudit(
      audit,
      (written.data || []).map((r) => ({ key: r.key as string, value: r.value as unknown }))
    );
  }
};

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

    const upserted = await settingsRepository.upsert(
      { key: parsed.data, value, updated_at: new Date().toISOString() },
      { accessToken: ctx.accessToken }
    );
    if (!upserted.success) return passFailure(upserted);
    if (!upserted.data) return failure("Failed to save setting", ErrorCodes.internal);
    return success(upserted.data);
  },

  async deleteKey(
    rawKey: string,
    ctx: ServiceContext
  ): Promise<ApiResult<{ key: string; deleted: true }>> {
    const parsed = settingsKeySchema.safeParse(rawKey);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const removed = await settingsRepository.remove(parsed.data, {
      accessToken: ctx.accessToken
    });
    if (!removed.success) return passFailure(removed);
    return success({ key: parsed.data, deleted: true });
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
    return success(
      (written.data || []).map((r) => ({ key: r.key, value: r.value }))
    );
  }
};

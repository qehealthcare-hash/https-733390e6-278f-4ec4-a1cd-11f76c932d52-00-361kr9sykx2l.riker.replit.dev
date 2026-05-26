/**
 * Lookup service — thin orchestration over `lookupRepository`. Read-only
 * dropdown / typeahead feeds. Returns ApiResult<...> like every other
 * service in the new stack so routes can stay uniform with `respond()`.
 */

import type { ApiResult } from "@/types/common";
import type { ServiceContext } from "@/types/serviceActor";
import { passFailure, success } from "@/utils/apiResponse";
import type { JsonRow } from "@/database/types";
import { lookupRepository } from "@/database/lookupRepository";

export const lookupService = {
  async patients(
    q: string | undefined,
    ctx: ServiceContext
  ): Promise<ApiResult<JsonRow[]>> {
    const result = await lookupRepository.patients(q, { accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    return success(result.data ?? []);
  },

  async employees(
    q: string | undefined,
    ctx: ServiceContext
  ): Promise<ApiResult<JsonRow[]>> {
    const result = await lookupRepository.employees(q, { accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    return success(result.data ?? []);
  },

  async services(ctx: ServiceContext): Promise<ApiResult<unknown[]>> {
    const result = await lookupRepository.services({ accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    return success(result.data ?? []);
  },

  async roles(ctx: ServiceContext): Promise<ApiResult<JsonRow[]>> {
    const result = await lookupRepository.roles({ accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    return success(result.data ?? []);
  }
};

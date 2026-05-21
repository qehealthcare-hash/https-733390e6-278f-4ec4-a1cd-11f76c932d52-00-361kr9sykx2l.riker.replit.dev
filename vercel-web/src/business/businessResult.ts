import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { failure } from "@/utils/apiResponse";

/** Business-rule violation (expected domain failure, not a bug). */
export function businessFailure(error: string, details?: unknown): ApiResult<never> {
  return failure(error, ErrorCodes.business, details);
}

export function businessOk(): ApiResult<null> {
  return { success: true, data: null };
}

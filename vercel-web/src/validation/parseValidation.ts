import type { ZodType } from "zod";
import type { ApiResult } from "@/types/common";
import { validationFailure } from "@/utils/apiResponse";

/** Parse unknown input with a Zod schema; never throws. */
export function parseInput<T>(schema: ZodType<T>, input: unknown): ApiResult<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    return validationFailure(result.error.flatten());
  }
  return { success: true, data: result.data };
}

import { expect } from "vitest";
import type { ApiResult } from "@/types/common";

type OkResult<T> = { success: true; data: T };

export function expectOk<T>(result: ApiResult<T>): asserts result is OkResult<T> {
  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
}

export function expectFail(
  result: ApiResult<unknown>,
  code?: string
): asserts result is { success: false; error?: string; code?: string } {
  expect(result.success).toBe(false);
  if (code) expect(result.code).toBe(code);
}

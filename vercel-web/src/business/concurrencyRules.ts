/**
 * Optimistic-locking helper.
 *
 * The shape mirrors the rest of `src/business/*` rules: pure, dependency-free,
 * returns `ApiResult<null>`. Use it from services right after `loadEntity` and
 * before the repository write, e.g.:
 *
 *   const guard = assertNotStale("Billing", existing.data.updated_at, input.expected_updated_at);
 *   if (!guard.success) return passFailure(guard);
 */
import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";

/**
 * Compare a client-supplied `expected_updated_at` against the row's actual
 * `updated_at`. Returns:
 *   - success when expected is absent (caller opted out of locking)
 *   - success when both timestamps parse equal to the second
 *   - failure (conflict) when the persisted row is newer than the expected
 *
 * Whitespace and timezone formatting differences are tolerated by parsing
 * both sides through `Date.parse` and comparing milliseconds at second
 * resolution.
 */
/**
 * PATCH/PUT updates must carry the `updated_at` the client loaded so we can
 * detect concurrent edits. Omitting the field disables locking entirely.
 */
export function requireExpectedVersion(
  entity: string,
  expectedUpdatedAt: unknown
): ApiResult<null> {
  if (normalise(expectedUpdatedAt)) return { success: true, data: null };
  return {
    success: false,
    error: `${entity} update requires expected_updated_at — reload the record and try again`,
    code: ErrorCodes.validation,
    details: { field: "expected_updated_at" }
  };
}

export function assertNotStale(
  entity: string,
  actualUpdatedAt: unknown,
  expectedUpdatedAt: unknown
): ApiResult<null> {
  const expected = normalise(expectedUpdatedAt);
  if (!expected) return { success: true, data: null };

  const actual = normalise(actualUpdatedAt);
  if (!actual) return { success: true, data: null };

  if (actual === expected) return { success: true, data: null };

  // Persisted is older or equal (after second-level rounding) — still safe.
  if (actual <= expected) return { success: true, data: null };

  return {
    success: false,
    error: `${entity} was modified by another user — reload and try again`,
    code: ErrorCodes.conflict,
    details: {
      entity,
      expected_updated_at: String(expectedUpdatedAt ?? ""),
      actual_updated_at: String(actualUpdatedAt ?? "")
    }
  };
}

function normalise(value: unknown): number | null {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  const ms = Date.parse(str);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000) * 1000;
}

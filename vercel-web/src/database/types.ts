/**
 * Database row shapes for Hominal CRM `hh_*` tables.
 * Rows are intentionally loose (`JsonRow`) because the legacy schema evolved
 * additively; services/business layers map to strict DTOs.
 */

/** Any row returned from Supabase PostgREST. */
export type JsonRow = Record<string, unknown>;

/** Pagination + sort options for list queries. */
export interface ListQuery {
  limit?: number;
  offset?: number;
  orderBy?: string;
  ascending?: boolean;
  /** PostgREST select clause, default `"*"`. */
  select?: string;
}

/** Standard paginated list result (before wrapping in ApiResult). */
export interface ListResult<T> {
  rows: T[];
  total: number;
}

/** Optional bearer token — when set, queries use RLS via userClient(). */
export interface DbAccess {
  accessToken?: string;
}

/** Month range for report queries (YYYY-MM). */
export interface MonthRange {
  period: string;
  startISO: string;
  endISO: string;
}

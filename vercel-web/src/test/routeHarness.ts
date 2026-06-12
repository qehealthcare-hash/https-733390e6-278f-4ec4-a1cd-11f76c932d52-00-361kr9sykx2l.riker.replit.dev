/**
 * Route-handler integration test harness.
 *
 * Builds NextRequest objects, drives the real `withAuth` → `requireActor`
 * pipeline (validating Bearer token, loading the actor from `hh_users`,
 * enforcing role), and runs the actual route handler exported from
 * `app/api/v1/.../route.ts`.
 *
 * Pattern (each test file):
 *
 *   import { vi } from "vitest";
 *   vi.mock("@/lib/api/supabase", async () => {
 *     const harness = await import("@/test/routeHarness");
 *     return harness.buildSupabaseMock();
 *   });
 *   vi.mock("@/services/mutationAudit", () => ({
 *     writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
 *     finalizeWithAudit: vi.fn((_a: unknown, data: unknown) => ({ success: true, data }))
 *   }));
 *   import { setActor, makeRequest } from "@/test/routeHarness";
 *
 * Service mocks (e.g. patientService) and per-test wiring stay inside each
 * test file so reviewers can read intent locally.
 */

import { NextRequest } from "next/server";
import { vi } from "vitest";

/** Actor that the next request will be authenticated as. */
export interface HarnessActor {
  userId: string;
  email: string;
  username?: string;
  role: string;
  is_active?: boolean;
}

interface HarnessState {
  /** The `hh_users` row that the request will resolve to (or null = not provisioned). */
  actor: HarnessActor | null;
  /**
   * Email that supabase `auth.getUser` reports for the current valid token.
   * Defaults to actor.email but can be set independently to test the
   * "valid Supabase token but not in `hh_users`" path → 403 forbidden.
   */
  authEmail: string | null;
  validToken: string;
}

const state: HarnessState = {
  actor: null,
  authEmail: null,
  validToken: "test-access-token"
};

/**
 * Set the `hh_users` row for the next request. Also defaults `authEmail` to
 * the same address so a single `setActor(ACTORS.admin)` call wires up both
 * the JWT identity and the CRM-side actor row.
 */
export function setActor(actor: HarnessActor | null): void {
  state.actor = actor;
  state.authEmail = actor?.email ?? null;
}

/**
 * Configure supabase `auth.getUser` to report a different email than the
 * `hh_users` row would resolve. Use this to exercise the "valid bearer but
 * actor not provisioned in CRM" → 403 forbidden branch.
 */
export function setAuthOnly(email: string): void {
  state.authEmail = email;
  state.actor = null;
}

export function clearAuth(): void {
  state.actor = null;
  state.authEmail = null;
}

/** In-memory idempotency cache shared across requests in a single test file. */
interface IdempotencyEntry {
  response: Record<string, unknown> | null;
  status: number;
  createdAt: string;
}
const idempotencyStore = new Map<string, IdempotencyEntry>();

export function resetIdempotencyStore(): void {
  idempotencyStore.clear();
}

export function getActor(): HarnessActor | null {
  return state.actor;
}

export function setValidToken(token: string): void {
  state.validToken = token;
}

export function currentValidToken(): string {
  return state.validToken;
}

/* ----------------------------- request builder ----------------------------- */

export interface MakeRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Override the bearer token used; default = current valid token if an actor is set. */
  bearer?: string | null;
  /** When true, omit the Authorization header entirely. */
  noAuth?: boolean;
  /** Replace the body with a raw string (for invalid-JSON tests). */
  rawBody?: string;
}

/**
 * Build a NextRequest that the route handlers can consume. By default it
 * attaches a Bearer token so `withAuth` succeeds.
 */
export function makeRequest(
  method: string,
  url: string,
  opts: MakeRequestOptions = {}
): NextRequest {
  const headers = new Headers();
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers.set(k, v);
  }
  if (!opts.noAuth) {
    const token =
      opts.bearer === null
        ? null
        : opts.bearer ??
          (state.actor || state.authEmail ? state.validToken : null);
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (
    opts.body !== undefined &&
    method.toUpperCase() !== "GET" &&
    method.toUpperCase() !== "HEAD" &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }

  const absoluteUrl = url.startsWith("http")
    ? url
    : `http://test.local${url.startsWith("/") ? url : `/${url}`}`;

  const init: {
    method: string;
    headers: Headers;
    body?: string;
  } = {
    method,
    headers
  };
  if (opts.rawBody !== undefined) {
    init.body = opts.rawBody;
  } else if (opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  return new NextRequest(absoluteUrl, init);
}

/** Helper used by tests to await JSON envelopes from NextResponses. */
export async function readJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/* --------------------------- params helper for Next 15 -------------------------- */

/**
 * Next 15's route handlers expect `ctx.params` as a Promise. The `withAuth`
 * wrapper unwraps it for us, but tests call the wrapped handler so the input
 * shape must match the runtime contract.
 */
export function ctx<P extends Record<string, string>>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

/* ----------------------------- supabase mock ----------------------------- */

/**
 * Builds the mock for `@/lib/api/supabase` consumed by `withAuth`,
 * `withIdempotency`, and the few routes that touch `supabaseAdmin()`
 * directly (uploads, health).
 *
 * Designed to satisfy the small surface used by the runtime; chainable
 * select/eq/gte/ilike/maybeSingle/insert/upsert/update all return
 * thenable shapes that resolve to `{ data, error }`.
 */
export function buildSupabaseMock(): {
  supabaseAdmin: () => unknown;
  supabaseAsUser: () => unknown;
  dbFor: () => unknown;
} {
  function hhUsersChain() {
    let activeFilter: boolean | null = null;
    let emailFilter: string | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      limit: () => chain,
      eq: (column: string, value: unknown) => {
        if (column === "is_active") activeFilter = !!value;
        return chain;
      },
      ilike: (column: string, value: string) => {
        if (column === "email") emailFilter = String(value).toLowerCase();
        return chain;
      },
      maybeSingle: async () => {
        const actor = state.actor;
        if (!actor) return { data: null, error: null };
        const expectedEmail = emailFilter ?? actor.email.toLowerCase();
        const matchesEmail = expectedEmail.toLowerCase() === actor.email.toLowerCase();
        const matchesActive = activeFilter == null || actor.is_active !== false;
        if (!matchesEmail || !matchesActive) {
          return { data: null, error: null };
        }
        return {
          data: {
            id: actor.userId,
            email: actor.email,
            username: actor.username ?? actor.email,
            role: actor.role,
            is_active: actor.is_active ?? true
          },
          error: null
        };
      }
    };
    return chain;
  }

  function hhRolesChain() {
    const chain: Record<string, unknown> = {
      select: () => chain,
      ilike: () => chain,
      maybeSingle: async () => ({
        data: { perms: ["patients.read", "patients.write", "billing.read"] },
        error: null
      })
    };
    return chain;
  }

  function idempotencyChain() {
    // Reflects the two-phase reserve/complete flow that lib/api/idempotency.ts
    // now drives (P0-3): a "pending" row is reserved with status = 0 BEFORE
    // the handler runs and is later UPDATEd with the final response/status.
    // The chain tracks filter state across .select/.eq/.gt so findCached,
    // tryReservePending and completePending all share one mock.
    let mode: "select" | "update" | "delete" | null = null;
    let pendingKey: string | null = null;
    let pendingActor: string | null = null;
    let statusEq: number | null = null;
    let statusGt: number | null = null;
    let responseIsNull = false;
    let createdBefore: string | null = null;
    let updateValues: Record<string, unknown> = {};

    const chain: Record<string, unknown> = {
      select: () => {
        mode = "select";
        return chain;
      },
      eq: (column: string, value: unknown) => {
        if (column === "key") pendingKey = String(value);
        else if (column === "actor") pendingActor = String(value);
        else if (column === "status") statusEq = Number(value);
        return chain;
      },
      gt: (column: string, value: unknown) => {
        if (column === "status") statusGt = Number(value);
        return chain;
      },
      gte: () => chain,
      lt: (column: string, value: unknown) => {
        if (column === "created_at") createdBefore = String(value);
        return chain;
      },
      is: (column: string, value: unknown) => {
        if (column === "response" && value === null) responseIsNull = true;
        return chain;
      },
      delete: () => {
        mode = "delete";
        return chain;
      },
      maybeSingle: async () => {
        if (!pendingKey || !pendingActor) return { data: null, error: null };
        const hit = idempotencyStore.get(`${pendingKey}|${pendingActor}`);
        if (!hit) return { data: null, error: null };
        if (statusGt !== null && hit.status <= statusGt) return { data: null, error: null };
        return {
          data: { response: hit.response, status: hit.status, created_at: hit.createdAt },
          error: null
        };
      },
      upsert: (
        row: Record<string, unknown>,
        opts?: { onConflict?: string; ignoreDuplicates?: boolean }
      ) => {
        const key = String(row.key ?? "");
        const actor = String(row.actor ?? "");
        const ignoreDuplicates = opts?.ignoreDuplicates === true;
        let inserted: string | null = null;
        if (key && actor) {
          const existing = idempotencyStore.get(`${key}|${actor}`);
          if (existing && ignoreDuplicates) {
            inserted = null; // conflict → ON CONFLICT DO NOTHING
          } else {
            idempotencyStore.set(`${key}|${actor}`, {
              response: (row.response as Record<string, unknown> | null) ?? null,
              status: (row.status as number) ?? 200,
              createdAt: existing?.createdAt ?? new Date().toISOString()
            });
            inserted = key;
          }
        }
        const result = inserted !== null ? [{ key: inserted }] : [];
        const upsertChain: Record<string, unknown> = {
          select: () => upsertChain,
          then: (resolve: (v: unknown) => unknown) => resolve({ data: result, error: null })
        };
        return upsertChain;
      },
      update: (row: Record<string, unknown>) => {
        mode = "update";
        updateValues = row;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (mode === "delete") {
          for (const [storeKey, entry] of idempotencyStore.entries()) {
            if (statusEq !== null && entry.status !== statusEq) continue;
            if (responseIsNull && entry.response !== null) continue;
            if (createdBefore && entry.createdAt >= createdBefore) continue;
            idempotencyStore.delete(storeKey);
          }
        }
        // Awaiting the chain after .update().eq().eq().eq() applies the update
        // if the (key, actor, status?) filter matches the stored entry.
        if (mode === "update" && pendingKey && pendingActor) {
          const existing = idempotencyStore.get(`${pendingKey}|${pendingActor}`);
          if (existing && (statusEq === null || existing.status === statusEq)) {
            idempotencyStore.set(`${pendingKey}|${pendingActor}`, {
              response:
                "response" in updateValues
                  ? ((updateValues.response as Record<string, unknown> | null) ?? null)
                  : existing.response,
              status:
                "status" in updateValues ? Number(updateValues.status) : existing.status,
              createdAt: existing.createdAt
            });
          }
        }
        return resolve({ data: null, error: null });
      },
      insert: async () => ({ data: null, error: null })
    };
    return chain;
  }

  function noopChain() {
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: () => chain,
      upsert: () => chain,
      update: () => chain,
      delete: () => chain,
      eq: () => chain,
      neq: () => chain,
      gt: () => chain,
      gte: () => chain,
      lt: () => chain,
      lte: () => chain,
      in: () => chain,
      ilike: () => chain,
      like: () => chain,
      is: () => chain,
      or: () => chain,
      order: () => chain,
      range: () => chain,
      limit: () => chain,
      head: async () => ({ data: null, error: null, count: 0 }),
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    };
    return chain;
  }

  function client() {
    return {
      auth: {
        getUser: async (token: string) => {
          if (token !== state.validToken) {
            return {
              data: null,
              error: { message: "Invalid token" }
            };
          }
          const email = state.authEmail;
          if (!email) {
            return {
              data: null,
              error: { message: "Invalid token" }
            };
          }
          return {
            data: {
              user: { email, id: state.actor?.userId ?? "AUTH_ONLY_USER" }
            },
            error: null
          };
        }
      },
      from: (table: string) => {
        if (table === "hh_users") return hhUsersChain();
        if (table === "hh_roles") return hhRolesChain();
        if (table === "hh_idempotency") return idempotencyChain();
        return noopChain();
      },
      rpc: async (fn: string) => {
        if (fn === "hominal_health_ping") {
          return { data: { ok: true, ts: new Date().toISOString() }, error: null };
        }
        return { data: null, error: null };
      },
      storage: {
        from: () => ({
          createSignedUploadUrl: async (path: string) => ({
            data: {
              path,
              token: "signed-upload-token",
              signedUrl: `https://example.supabase.co/storage/v1/object/sign/${path}?token=signed-upload-token`
            },
            error: null
          }),
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/${path}?token=download` },
            error: null
          })
        })
      }
    };
  }

  const shared = client();
  return {
    supabaseAdmin: () => shared,
    supabaseAsUser: () => shared,
    dbFor: () => shared
  };
}

/* ----------------------------- audit mock helpers ----------------------------- */

/**
 * Convenience factory the per-file `vi.mock("@/services/mutationAudit")`
 * factory can return so audits are stubbed identically across the suite.
 */
export function buildMutationAuditMock() {
  return {
    writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
    finalizeWithAudit: vi.fn((_a: unknown, data: unknown) => ({ success: true, data }))
  };
}

/* ----------------------------- common assertions ----------------------------- */

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: unknown;
}

export async function expectStatus(res: Response, status: number, hint = ""): Promise<void> {
  if (res.status === status) return;
  const text = await res.clone().text().catch(() => "");
  throw new Error(
    `Expected status ${status} but got ${res.status}. ${hint}\nBody: ${text.slice(0, 500)}`
  );
}

export async function expectOkEnvelope<T = unknown>(res: Response): Promise<T> {
  await expectStatus(res, 200);
  const body = await readJson<ApiEnvelope<T>>(res);
  if (!body.success) {
    throw new Error(`Expected success=true, got error=${body.error} code=${body.code}`);
  }
  return body.data as T;
}

export async function expectCreatedEnvelope<T = unknown>(res: Response): Promise<T> {
  await expectStatus(res, 201);
  const body = await readJson<ApiEnvelope<T>>(res);
  if (!body.success) {
    throw new Error(`Expected success=true, got error=${body.error} code=${body.code}`);
  }
  return body.data as T;
}

export async function expectErrorEnvelope(
  res: Response,
  status: number,
  code?: string
): Promise<ApiEnvelope> {
  await expectStatus(res, status);
  const body = await readJson<ApiEnvelope>(res);
  if (body.success) throw new Error("Expected success=false");
  if (code && body.code !== code) {
    throw new Error(`Expected code=${code} but got ${body.code} (${body.error})`);
  }
  return body;
}

/* ----------------------------- preset actors ----------------------------- */

export const ACTORS = {
  admin: {
    userId: "USER_ADMIN",
    email: "admin@hominal.test",
    username: "admin",
    role: "Admin",
    is_active: true
  } as HarnessActor,
  manager: {
    userId: "USER_MANAGER",
    email: "manager@hominal.test",
    username: "manager",
    role: "Manager",
    is_active: true
  } as HarnessActor,
  staff: {
    userId: "USER_STAFF",
    email: "staff@hominal.test",
    username: "staff",
    role: "Staff",
    is_active: true
  } as HarnessActor,
  accountant: {
    userId: "USER_ACCT",
    email: "accountant@hominal.test",
    username: "accountant",
    role: "Accountant",
    is_active: true
  } as HarnessActor,
  nurse: {
    userId: "USER_NURSE",
    email: "nurse@hominal.test",
    username: "nurse",
    role: "Nurse",
    is_active: true
  } as HarnessActor,
  /**
   * "Unknown role" fixture (legacy name `viewer` preserved so existing
   * RBAC matrix tests keep compiling). The role string "Viewer" is NOT
   * in CANONICAL_ROLES — production has never had this role — but the
   * fixture is intentionally kept to drive the route-level 403 path
   * for any unrecognised role. The `role` field is cast through
   * `unknown` because `HarnessActor.role` is typed as `Role` now;
   * the cast is the explicit "yes, this is invalid on purpose" signal.
   *
   * If you find yourself using this fixture in a test that expects a
   * 200, you're using the wrong fixture — pick `staff` / `nurse` /
   * etc. instead.
   */
  viewer: {
    userId: "USER_UNKNOWN_ROLE",
    email: "unknown-role@hominal.test",
    username: "unknown_role",
    role: "Viewer",
    is_active: true
  } as HarnessActor
};

/**
 * Shared HTTP transport for the CRM browser client.
 *
 * `request` unwraps the canonical `{ success, data, error }` envelope.
 * `requestValidated` additionally runs the payload through the same Zod
 * read-model schemas used by `respondValidated()` on the server so wire
 * contract drift is caught in the browser during development and staging.
 */

import type { ZodType } from "zod";
import { appConfig } from "./config";
import { dispatchDataInvalidated } from "./data-invalidation";
import { parseOutput } from "@/validation/parseValidation";
import { refreshSessionDtoSchema } from "@/validation/authDto";

const offlineQueueKey = "hhcrm-offline-queue";
const OFFLINE_RETRY_CAP = 5;
export const OFFLINE_QUEUED_CODE = "offline_queued";
export const CONTRACT_ERROR_CODE = "contract_error";

export type ApiSession = { access_token?: string } | null | undefined;

export type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  /** Required for routes that clear HttpOnly cookies (e.g. logout). */
  credentials?: RequestCredentials;
};

type ApiClientError = Error & {
  code?: string;
  status?: number;
  details?: unknown;
};

type OfflineQueueEntry = {
  path: string;
  options: ApiRequestOptions;
  attempts?: number;
  queued_at?: number;
};

function fnv1aHex(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function canonicalizeForHash(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return canonicalizeForHash(item);
    });
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const out: Record<string, unknown> = {};
  for (let j = 0; j < keys.length; j += 1) {
    const key = keys[j];
    if (!key) continue;
    out[key] = canonicalizeForHash((value as Record<string, unknown>)[key]);
  }
  return out;
}

function synthIdempotencyKey(method: string, path: string, body: unknown): string {
  const upper = String(method).toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return "";
  const canonical = body == null ? "" : JSON.stringify(canonicalizeForHash(body));
  const payload = path + " | " + canonical;
  const splitAt = Math.max(1, Math.floor(payload.length / 2));
  return "auto-" + fnv1aHex(payload.slice(0, splitAt)) + fnv1aHex(payload.slice(splitAt));
}

function readQueue(): OfflineQueueEntry[] {
  try {
    return JSON.parse(window.localStorage.getItem(offlineQueueKey) || "[]") as OfflineQueueEntry[];
  } catch {
    return [];
  }
}

function saveQueue(queue: OfflineQueueEntry[]): void {
  window.localStorage.setItem(offlineQueueKey, JSON.stringify(queue));
}

function unwrapResponse(json: Record<string, unknown>, response: Response): unknown {
  if (typeof json.success === "boolean") {
    if (!json.success) {
      const err: ApiClientError = new Error(String(json.error || "Request failed"));
      if (json.code) err.code = String(json.code);
      if (json.details !== undefined) err.details = json.details;
      err.status = response.status;
      throw err;
    }
    return json.data;
  }
  if (!response.ok) {
    const hardErr: ApiClientError = new Error(
      String(json.message || json.error || "Request failed")
    );
    hardErr.status = response.status;
    throw hardErr;
  }
  return json.data !== undefined ? json.data : json;
}

/**
 * After a successful mutating request, broadcast a single invalidation so that
 * screens without their own Supabase realtime subscription (dashboard, reports)
 * refetch immediately instead of showing stale numbers until the next manual
 * reload. GET/HEAD/OPTIONS never broadcast (they would cause reload loops), and
 * auth endpoints are excluded to avoid refresh-token churn.
 */
function maybeDispatchMutationInvalidation(method: string | undefined, path: string): void {
  const upper = String(method || "GET").toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return;
  if (path.startsWith("/auth/")) return;
  dispatchDataInvalidated("mutation");
}

function isExpiredAuthError(error: unknown): boolean {
  const err = error as ApiClientError;
  const msg = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (err?.status !== 401 && err?.status !== 403) return false;
  return (
    code === "unauthorized" ||
    msg.includes("jwt") ||
    msg.includes("token is expired") ||
    msg.includes("invalid claims") ||
    msg.includes("session expired")
  );
}

async function refreshSessionFromCookie(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const res = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include"
  });
  const json = (await res.json().catch(function () {
    return {};
  })) as Record<string, unknown>;
  if (!res.ok || json?.success === false) return null;
  const payload = json?.data !== undefined ? json.data : json;
  const validated = parseOutput(refreshSessionDtoSchema, payload);
  if (!validated.success || !validated.data?.access_token) return null;
  return validated.data.access_token;
}

async function fetchApi(
  path: string,
  options: ApiRequestOptions | null | undefined,
  session: ApiSession
): Promise<Response> {
  const method = options?.method || "GET";
  const explicitHeaders = (options && options.headers) || {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: session?.access_token ? "Bearer " + session.access_token : ""
  };
  for (const hk in explicitHeaders) {
    if (Object.prototype.hasOwnProperty.call(explicitHeaders, hk)) {
      headers[hk] = explicitHeaders[hk] || "";
    }
  }
  if (!headers["Idempotency-Key"] && !headers["idempotency-key"]) {
    const auto = synthIdempotencyKey(method, path, options?.body);
    if (auto) headers["Idempotency-Key"] = auto;
  }

  return fetch(appConfig.apiUrl + path, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
    credentials: options?.credentials
  });
}

async function parseApiResponse(path: string, response: Response): Promise<unknown> {
  const raw = await response.text();
  let json: Record<string, unknown>;
  if (raw === "" || raw == null) {
    json = {};
  } else {
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const preview = raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
      const perr: ApiClientError = new Error(
        "API " + path + " returned HTTP " + response.status + " with non-JSON body: " + preview
      );
      perr.code = "bad_response";
      perr.status = response.status;
      throw perr;
    }
  }
  return unwrapResponse(json, response);
}

export async function flushOfflineQueue(session: ApiSession): Promise<void> {
  const queue = readQueue();
  if (!queue.length || !session?.access_token) return;
  const failed: OfflineQueueEntry[] = [];
  let flushed = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i] || ({} as OfflineQueueEntry);
    const attempts = Number(entry.attempts || 0);
    try {
      await request(entry.path, entry.options, session);
      flushed += 1;
    } catch {
      if (attempts + 1 < OFFLINE_RETRY_CAP) {
        entry.attempts = attempts + 1;
        failed.push(entry);
      }
    }
  }
  saveQueue(failed);
  if (flushed > 0) dispatchDataInvalidated("offline-queue");
}

export async function request<T = any>(
  path: string,
  options: ApiRequestOptions | null | undefined,
  session: ApiSession
): Promise<T> {
  let response: Response;
  try {
    response = await fetchApi(path, options, session);
  } catch (networkError: unknown) {
    const nerr: ApiClientError = new Error(
      "Network error — could not reach " +
        appConfig.apiUrl +
        path +
        " (" +
        (networkError instanceof Error ? networkError.message : "offline") +
        ")"
    );
    nerr.code = "network_error";
    throw nerr;
  }

  try {
    const parsed = (await parseApiResponse(path, response)) as T;
    maybeDispatchMutationInvalidation(options?.method, path);
    return parsed;
  } catch (error: unknown) {
    if (!path.startsWith("/auth/") && isExpiredAuthError(error)) {
      const refreshed = await refreshSessionFromCookie();
      if (refreshed) {
        if (session && typeof session === "object") session.access_token = refreshed;
        const retried = await fetchApi(path, options, { access_token: refreshed });
        const parsedRetry = (await parseApiResponse(path, retried)) as T;
        maybeDispatchMutationInvalidation(options?.method, path);
        return parsedRetry;
      }
    }
    throw error;
  }
}

function contractError(path: string, validated: { error?: string; code?: string; details?: unknown }): ApiClientError {
  const err: ApiClientError = new Error(
    "API " + path + " returned data that failed contract validation"
  );
  err.code = CONTRACT_ERROR_CODE;
  if (validated.details !== undefined) err.details = validated.details;
  err.status = 500;
  return err;
}

/** Parse an already-unwrapped payload with a Zod read-model schema. */
export function validateApiPayload<T>(path: string, payload: unknown, schema: ZodType<T>): T {
  const validated = parseOutput(schema, payload);
  if (!validated.success) throw contractError(path, validated);
  if (validated.data === undefined) {
    throw contractError(path, { error: "Response validation returned no data" });
  }
  return validated.data;
}

export async function requestValidated<T>(
  path: string,
  options: ApiRequestOptions | null | undefined,
  session: ApiSession,
  schema: ZodType<T>
): Promise<T> {
  const payload = await request<unknown>(path, options, session);
  return validateApiPayload(path, payload, schema);
}

export async function requestValidatedWithOfflineFallback<T>(
  path: string,
  options: ApiRequestOptions,
  session: ApiSession,
  schema: ZodType<T>
): Promise<T> {
  const payload = await requestWithOfflineFallback<unknown>(path, options, session);
  return validateApiPayload(path, payload, schema);
}

function queueFingerprint(path: string, options: ApiRequestOptions): string {
  const method = options?.method || "GET";
  const body =
    options?.body == null ? "" : JSON.stringify(canonicalizeForHash(options.body));
  return method + "|" + path + "|" + body;
}

function enqueueRetry(path: string, options: ApiRequestOptions): void {
  if (typeof window === "undefined") return;
  if (!options || !options.method || options.method === "GET") return;
  if (path === "/auth/login") return;
  const fingerprint = queueFingerprint(path, options);
  const queue = readQueue().filter(function (entry) {
    return queueFingerprint(entry.path, entry.options) !== fingerprint;
  });
  queue.push({ path, options, attempts: 0, queued_at: Date.now() });
  saveQueue(queue);
}

export async function requestWithOfflineFallback<T = any>(
  path: string,
  options: ApiRequestOptions,
  session: ApiSession
): Promise<T> {
  try {
    return await request<T>(path, options, session);
  } catch (error: unknown) {
    const err = error as ApiClientError;
    const transient5xx = typeof err?.status === "number" && err.status >= 500;
    const networkReject = err?.code === "network_error";
    if (typeof window !== "undefined" && options?.method && options.method !== "GET") {
      if (transient5xx || networkReject || !navigator.onLine) {
        enqueueRetry(path, options);
        const queued: ApiClientError = new Error(
          "Saved offline — will sync automatically when connection returns"
        );
        queued.code = OFFLINE_QUEUED_CODE;
        throw queued;
      }
    }
    throw error;
  }
}

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
import { parseOutput, parseOutputSanitized, type OutputSanitizeOptions } from "@/validation/parseValidation";
import { refreshSessionDtoSchema } from "@/validation/authDto";

const offlineQueueKey = "hhcrm-offline-queue";
const OFFLINE_RETRY_CAP = 5;
export const OFFLINE_QUEUED_CODE = "offline_queued";
export const CONTRACT_ERROR_CODE = "contract_error";
export const RETRYABLE_ERROR_CODE = "retryable";

const MAX_TRANSIENT_RETRIES = 3;
const RETRYABLE_HTTP = new Set([502, 503, 504, 522, 524]);

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
  retryable?: boolean;
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

function envelopeFailureMessage(
  error: unknown,
  code: unknown,
  status?: number
): string {
  const msg = String(error || "").trim();
  const codeStr = String(code || "").trim();
  if (msg && msg !== "Request failed") return msg;
  if (codeStr === "internal_error") {
    return "Server error — try again. If this persists, contact support.";
  }
  if (codeStr === "validation_error" || codeStr === "validation") {
    return "Validation failed — check the form and try again.";
  }
  if (codeStr === "idempotent_pending") {
    return "Save still processing — wait a moment and retry.";
  }
  if (codeStr === CONTRACT_ERROR_CODE) {
    return "Data format mismatch — refresh the page and try again.";
  }
  if (codeStr === "upstream_error") {
    return "Sign-in service is temporarily unavailable — wait a minute and try again.";
  }
  if (codeStr === RETRYABLE_ERROR_CODE) {
    return humanizeGatewayBody(status || 0, "");
  }
  if (codeStr === "upstream_error") {
    return "Sign-in service is temporarily unavailable — wait a minute and try again.";
  }
  if (status === 401 || status === 403 || codeStr === "unauthorized") {
    return "Session expired — sign in again.";
  }
  if (status && status >= 500) {
    return "Server error (HTTP " + status + ") — try again.";
  }
  return msg || "Request failed";
}

function unwrapResponse(json: Record<string, unknown>, response: Response): unknown {
  if (typeof json.success === "boolean") {
    if (!json.success) {
      const err: ApiClientError = new Error(
        humanizeClientError(
          envelopeFailureMessage(json.error, json.code, response.status)
        )
      );
      if (json.code) err.code = String(json.code);
      if (json.details !== undefined) err.details = json.details;
      err.status = response.status;
      throw err;
    }
    return json.data;
  }
  if (!response.ok) {
    const hardErr: ApiClientError = new Error(
      humanizeClientError(
        envelopeFailureMessage(json.message || json.error, json.code, response.status)
      )
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

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function retryBackoffMs(attempt: number): number {
  const base = 400 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(base + jitter, 4000);
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_HTTP.has(status);
}

function isJsonContentType(contentType: string | null): boolean {
  const ct = String(contentType || "").toLowerCase();
  return ct.includes("application/json") || ct.includes("+json");
}

function logUpstreamBody(path: string, status: number, raw: string): void {
  const preview = raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
  console.warn("[api-client] non-JSON upstream response", { path, status, preview });
}

async function fetchApiWithRetry(
  path: string,
  options: ApiRequestOptions | null | undefined,
  session: ApiSession
): Promise<Response> {
  let lastError: unknown;
  const skipRetry = path.startsWith("/auth/");
  for (let attempt = 0; attempt < MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      const response = await fetchApi(path, options, session);
      if (
        !skipRetry &&
        isRetryableStatus(response.status) &&
        attempt < MAX_TRANSIENT_RETRIES - 1
      ) {
        await sleep(retryBackoffMs(attempt));
        continue;
      }
      return response;
    } catch (networkError: unknown) {
      lastError = networkError;
      if (!skipRetry && attempt < MAX_TRANSIENT_RETRIES - 1) {
        await sleep(retryBackoffMs(attempt));
        continue;
      }
      const nerr: ApiClientError = new Error(
        "Network error — could not reach " +
          appConfig.apiUrl +
          path +
          " (" +
          (networkError instanceof Error ? networkError.message : "offline") +
          ")"
      );
      nerr.code = "network_error";
      nerr.retryable = true;
      throw nerr;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

async function parseApiResponse(path: string, response: Response): Promise<unknown> {
  const raw = await response.text();
  const contentType =
    response.headers && typeof response.headers.get === "function"
      ? response.headers.get("content-type")
      : null;
  const looksHtml = /^\s*</.test(raw) || /<!doctype\s+html|<html[\s>]/i.test(raw);

  if (looksHtml || (!isJsonContentType(contentType) && raw.trim() && !raw.trim().startsWith("{"))) {
    logUpstreamBody(path, response.status, raw);
    const perr: ApiClientError = new Error(humanizeGatewayBody(response.status, raw));
    perr.code = isRetryableStatus(response.status) ? RETRYABLE_ERROR_CODE : "bad_response";
    perr.status = response.status;
    perr.retryable = isRetryableStatus(response.status);
    throw perr;
  }

  let json: Record<string, unknown>;
  if (raw === "" || raw == null) {
    json = {};
  } else {
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logUpstreamBody(path, response.status, raw);
      const perr: ApiClientError = new Error(humanizeGatewayBody(response.status, raw));
      perr.code = isRetryableStatus(response.status) ? RETRYABLE_ERROR_CODE : "bad_response";
      perr.status = response.status;
      perr.retryable = isRetryableStatus(response.status);
      throw perr;
    }
  }

  // Canonical API envelope — unwrap even on 502/503 so upstream_error text is preserved.
  if (typeof json.success === "boolean") {
    return unwrapResponse(json, response);
  }

  if (!response.ok && isRetryableStatus(response.status)) {
    const perr: ApiClientError = new Error(humanizeGatewayBody(response.status, raw));
    perr.code = RETRYABLE_ERROR_CODE;
    perr.status = response.status;
    perr.retryable = true;
    throw perr;
  }

  return unwrapResponse(json, response);
}

/** Map proxy / gateway HTML bodies to operator-friendly copy (never dump HTML in the UI). */
function humanizeGatewayBody(status: number, raw: string): string {
  const lower = raw.toLowerCase();
  if (
    status === 522 ||
    status === 524 ||
    status === 504 ||
    lower.includes("connection timed out") ||
    lower.includes("gateway time-out")
  ) {
    return "Server timed out — the request took too long. Try again or narrow your filters.";
  }
  if (status === 503 || lower.includes("temporarily unavailable")) {
    return "Server is temporarily unavailable. Please try again in a moment.";
  }
  if (/<!doctype\s+html|<html[\s>]/i.test(raw)) {
    return "Server returned an unexpected error page (HTTP " + status + "). Please try again.";
  }
  return "Server returned an invalid response (HTTP " + status + "). Please try again.";
}

/**
 * Sanitize any client-side error message before showing it in banners/toasts.
 * Strips HTML error pages from Cloudflare/Vercel and maps gateway timeouts.
 */
export function humanizeClientError(error: unknown): string {
  const err = error as ApiClientError;
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error || "");
  const status = err?.status;
  const code = String(err?.code || "");
  if (/<!doctype\s+html|<html[\s>]/i.test(raw) || /cloudflare/i.test(raw)) {
    return humanizeGatewayBody(status || 0, raw);
  }
  if (/non-json body/i.test(raw)) {
    return humanizeGatewayBody(status || 0, raw);
  }
  if (status === 522 || status === 524 || status === 504) {
    return "Server timed out — the request took too long. Try again or narrow your filters.";
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "Request failed") {
    return envelopeFailureMessage(trimmed, code, status);
  }
  if (trimmed === "Response validation failed") {
    return "Server returned unexpected data — refresh the page. Support has been notified.";
  }
  if (code === CONTRACT_ERROR_CODE && !trimmed.includes("contract validation")) {
    return "Data format mismatch — refresh the page and try again.";
  }
  if (code === "upstream_error") {
    return trimmed || "Sign-in service is temporarily unavailable — wait a minute and try again.";
  }
  return trimmed;
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
    response = await fetchApiWithRetry(path, options, session);
  } catch (networkError: unknown) {
    throw networkError;
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
        const retried = await fetchApiWithRetry(path, options, { access_token: refreshed });
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
    validated.error && validated.error !== "Response validation failed"
      ? "API " + path + ": " + validated.error
      : "API " + path + " returned data that failed contract validation"
  );
  err.code = CONTRACT_ERROR_CODE;
  if (validated.details !== undefined) err.details = validated.details;
  err.status = 500;
  return err;
}

/** Parse an already-unwrapped payload with a Zod read-model schema. */
export function validateApiPayload<T>(
  path: string,
  payload: unknown,
  schema: ZodType<T>,
  sanitize?: OutputSanitizeOptions
): T {
  const validated = sanitize
    ? parseOutputSanitized(schema, payload, sanitize)
    : parseOutput(schema, payload);
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
  schema: ZodType<T>,
  sanitize?: OutputSanitizeOptions
): Promise<T> {
  const payload = await request<unknown>(path, options, session);
  return validateApiPayload(path, payload, schema, sanitize);
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

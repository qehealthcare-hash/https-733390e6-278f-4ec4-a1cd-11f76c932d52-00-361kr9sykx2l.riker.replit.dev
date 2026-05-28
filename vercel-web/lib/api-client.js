import { appConfig } from "./config";

var offlineQueueKey = "hhcrm-offline-queue";

/**
 * Synthesise a deterministic Idempotency-Key for a write request.
 *
 * Strategy: hash(method + path + body + 5-second timestamp bucket). Two
 * clicks of the same button posting the same body within the same 5-second
 * window collide on the key, so the server (`withIdempotency`) replays the
 * cached response instead of duplicating the write. A deliberate "do the
 * same thing again 10 seconds later" lands in a new bucket and gets a fresh
 * key, so legitimate repeats still work.
 *
 * Why we generate this client-side: every write route in the CRM is wrapped
 * by `withIdempotency`, but it short-circuits when the header is missing.
 * Historically none of the legacy SPA call sites set the header, which left
 * the entire fleet exposed to double-click duplicates on flaky networks.
 */
function fnv1aHex(input) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Recursively sort object keys so two semantically-identical bodies hash to
 * the same canonical string. `{a:1,b:2}` and `{b:2,a:1}` collide; arrays
 * preserve their order (arrays are positional, not associative).
 */
function canonicalizeForHash(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    var arr = [];
    for (var i = 0; i < value.length; i += 1) arr.push(canonicalizeForHash(value[i]));
    return arr;
  }
  var keys = Object.keys(value).sort();
  var out = {};
  for (var j = 0; j < keys.length; j += 1) out[keys[j]] = canonicalizeForHash(value[keys[j]]);
  return out;
}

/**
 * Stable hash of (path + canonical JSON body). No method, no time bucket.
 *
 * Dropping the time bucket means React strict-mode double-fires (which
 * happen microseconds apart) AND deliberate retries minutes later share the
 * same Idempotency-Key. The server-side `withIdempotency` reserves a
 * pending row with ON CONFLICT DO NOTHING so the second call replays the
 * cached response instead of running the handler twice.
 */
function synthIdempotencyKey(method, path, body) {
  if (!method) return "";
  var upper = String(method).toUpperCase();
  if (upper === "GET" || upper === "HEAD" || upper === "OPTIONS") return "";
  var canonical = body == null ? "" : JSON.stringify(canonicalizeForHash(body));
  var payload = path + " | " + canonical;
  var splitAt = Math.max(1, Math.floor(payload.length / 2));
  return "auto-" + fnv1aHex(payload.slice(0, splitAt)) + fnv1aHex(payload.slice(splitAt));
}

function readQueue() {
  try {
    return JSON.parse(window.localStorage.getItem(offlineQueueKey) || "[]");
  } catch (error) {
    return [];
  }
}

function saveQueue(queue) {
  window.localStorage.setItem(offlineQueueKey, JSON.stringify(queue));
}

/**
 * Unwrap Phase 6 canonical `{ success, data, error, details, code }` or legacy
 * `{ ok, data, message }` for backward compatibility during iframe migration.
 */
function unwrapResponse(json, response) {
  if (json && typeof json.success === "boolean") {
    if (!json.success) {
      var err = new Error(json.error || "Request failed");
      if (json.code) err.code = json.code;
      if (json.details !== undefined) err.details = json.details;
      err.status = response.status;
      throw err;
    }
    return json.data;
  }
  if (!response.ok) {
    var hardErr = new Error(json.message || json.error || "Request failed");
    hardErr.status = response.status;
    throw hardErr;
  }
  return json.data !== undefined ? json.data : json;
}

export async function flushOfflineQueue(session) {
  var queue = readQueue();
  if (!queue.length || !session?.access_token) return;
  var failed = [];
  for (var i = 0; i < queue.length; i += 1) {
    try {
      await request(queue[i].path, queue[i].options, session);
    } catch (error) {
      failed.push(queue[i]);
    }
  }
  saveQueue(failed);
}

export async function request(path, options, session) {
  var method = options?.method || "GET";
  var explicitHeaders = (options && options.headers) || {};
  var headers = {
    "Content-Type": "application/json",
    Authorization: session?.access_token ? "Bearer " + session.access_token : ""
  };
  // Merge caller-supplied headers (case-preserving) so an explicit
  // Idempotency-Key from the caller wins over our synthesised one.
  for (var hk in explicitHeaders) {
    if (Object.prototype.hasOwnProperty.call(explicitHeaders, hk)) headers[hk] = explicitHeaders[hk];
  }
  if (!headers["Idempotency-Key"] && !headers["idempotency-key"]) {
    var auto = synthIdempotencyKey(method, path, options?.body);
    if (auto) headers["Idempotency-Key"] = auto;
  }

  var response;
  try {
    response = await fetch(appConfig.apiUrl + path, {
      method: method,
      headers: headers,
      body: options?.body ? JSON.stringify(options.body) : undefined
    });
  } catch (networkError) {
    var nerr = new Error(
      "Network error — could not reach " + appConfig.apiUrl + path + " (" + (networkError?.message || "offline") + ")"
    );
    nerr.code = "network_error";
    throw nerr;
  }

  // Read the body as text first so we can give a useful message when the
  // server returns HTML (e.g. a Vercel error page) instead of JSON. This
  // turns the user-facing "Unexpected token < in JSON at position 0" into
  // a clear "API ... returned HTTP 500" message.
  var raw = await response.text();
  var json;
  if (raw === "" || raw == null) {
    json = {};
  } else {
    try {
      json = JSON.parse(raw);
    } catch (parseError) {
      var preview = raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
      var perr = new Error(
        "API " + path + " returned HTTP " + response.status +
          " with non-JSON body: " + preview
      );
      perr.code = "bad_response";
      perr.status = response.status;
      throw perr;
    }
  }
  return unwrapResponse(json, response);
}

export async function requestWithOfflineFallback(path, options, session) {
  try {
    return await request(path, options, session);
  } catch (error) {
    if (typeof window !== "undefined" && !navigator.onLine && options?.method && options.method !== "GET") {
      var queue = readQueue();
      queue.push({ path, options });
      saveQueue(queue);
    }
    throw error;
  }
}

import { appConfig } from "./config";

var offlineQueueKey = "hhcrm-offline-queue";

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
      throw err;
    }
    return json.data;
  }
  if (!response.ok) {
    throw new Error(json.message || json.error || "Request failed");
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
  var response = await fetch(appConfig.apiUrl + path, {
    method: options?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: session?.access_token ? "Bearer " + session.access_token : ""
    },
    body: options?.body ? JSON.stringify(options.body) : undefined
  });

  var json = await response.json();
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

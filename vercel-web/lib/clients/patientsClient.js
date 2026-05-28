import { request, requestWithOfflineFallback } from "@/lib/api-client";

/** API base path (without `/api/v1` prefix — `api-client` adds that). */
export const PATIENTS_BASE = "/patients";

export const patientsClient = {
  basePath: PATIENTS_BASE,

  /**
   * Query string for list filters (used by `usePaginatedResource` via `queryParams`).
   * @param {Record<string, string | undefined>} filters
   */
  listFiltersToQuery(filters) {
    return filters || {};
  },

  /**
   * @param {import("@supabase/supabase-js").Session | null} session
   * @param {string} id
   */
  get(session, id) {
    return request(PATIENTS_BASE + "/" + encodeURIComponent(id), null, session);
  },

  /**
   * @param {import("@supabase/supabase-js").Session | null} session
   * @param {Record<string, unknown>} body
   */
  create(session, body) {
    return requestWithOfflineFallback(
      PATIENTS_BASE,
      { method: "POST", body: body },
      session
    );
  },

  /**
   * @param {import("@supabase/supabase-js").Session | null} session
   * @param {string} id
   * @param {Record<string, unknown>} body
   */
  update(session, id, body) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id),
      { method: "PUT", body: body },
      session
    );
  },

  /** Create or update depending on whether `body.id` is set. */
  save(session, body) {
    var id = body && body.id ? String(body.id) : "";
    if (id) return this.update(session, id, body);
    return this.create(session, body);
  },

  /**
   * Soft-close (status → Closed) with optional reason payload.
   * @param {import("@supabase/supabase-js").Session | null} session
   * @param {string} id
   * @param {Record<string, unknown>} [body]
   */
  close(session, id, body) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id),
      { method: "DELETE", body: body || {} },
      session
    );
  },

  /**
   * @param {import("@supabase/supabase-js").Session | null} session
   * @param {string} id
   * @param {Record<string, unknown>} [body]
   */
  reopen(session, id, body) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id) + "/reopen",
      { method: "POST", body: body || {} },
      session
    );
  },

  /**
   * Permanent delete when no linked billings/duties block removal.
   * @param {import("@supabase/supabase-js").Session | null} session
   * @param {string} id
   */
  hardDelete(session, id) {
    return requestWithOfflineFallback(
      PATIENTS_BASE + "/" + encodeURIComponent(id) + "?hard=1",
      { method: "DELETE" },
      session
    );
  },

  /**
   * @param {import("@supabase/supabase-js").Session | null} session
   * @param {string} id
   */
  history(session, id) {
    return request(PATIENTS_BASE + "/" + encodeURIComponent(id) + "/history", null, session);
  }
};

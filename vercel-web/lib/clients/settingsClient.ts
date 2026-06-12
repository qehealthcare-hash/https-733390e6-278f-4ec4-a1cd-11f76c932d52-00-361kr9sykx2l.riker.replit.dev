import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";

export const SETTINGS_BASE = "/settings";

export const settingsClient = {
  get(session: ApiSession) {
    return request(SETTINGS_BASE, null, session);
  },

  saveKey(session: ApiSession, key: string, value: unknown) {
    return requestWithOfflineFallback(
      SETTINGS_BASE + "/" + encodeURIComponent(key),
      { method: "PUT", body: { value } },
      session
    );
  },

  deleteKey(session: ApiSession, key: string) {
    return requestWithOfflineFallback(
      SETTINGS_BASE + "/" + encodeURIComponent(key),
      { method: "DELETE" },
      session
    );
  }
};

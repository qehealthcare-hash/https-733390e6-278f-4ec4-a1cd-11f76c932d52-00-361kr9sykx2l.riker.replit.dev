import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import {
  settingsDeleteResultDtoSchema,
  settingsMapDtoSchema,
  settingsRowDtoSchema,
} from "@/validation/settingsDto";

export const SETTINGS_BASE = "/settings";

export const settingsClient = {
  get(session: ApiSession) {
    return requestValidated(SETTINGS_BASE, null, session, settingsMapDtoSchema);
  },

  saveKey(session: ApiSession, key: string, value: unknown) {
    return requestValidatedWithOfflineFallback(
      SETTINGS_BASE + "/" + encodeURIComponent(key),
      { method: "PUT", body: { value } },
      session,
      settingsRowDtoSchema
    );
  },

  deleteKey(session: ApiSession, key: string) {
    return requestValidatedWithOfflineFallback(
      SETTINGS_BASE + "/" + encodeURIComponent(key),
      { method: "DELETE" },
      session,
      settingsDeleteResultDtoSchema
    );
  }
};

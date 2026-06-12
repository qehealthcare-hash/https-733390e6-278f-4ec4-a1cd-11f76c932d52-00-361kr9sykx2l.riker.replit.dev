import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import type { ClientListParams } from "@/lib/clients/types";

export const INQUIRIES_BASE = "/inquiries";

function inquiryPath(id: string, suffix = "") {
  return INQUIRIES_BASE + "/" + encodeURIComponent(id) + suffix;
}

export const inquiriesClient = {
  basePath: INQUIRIES_BASE,

  list(session: ApiSession, params?: ClientListParams) {
    return request(withQuery(INQUIRIES_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(inquiryPath(id), null, session);
  },

  save(session: ApiSession, body: Record<string, unknown>) {
    const id = body?.id ? String(body.id) : "";
    if (id) {
      return requestWithOfflineFallback(inquiryPath(id), { method: "PUT", body }, session);
    }
    return requestWithOfflineFallback(INQUIRIES_BASE, { method: "POST", body }, session);
  },

  setStatus(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(inquiryPath(id, "/status"), { method: "POST", body }, session);
  },

  remove(session: ApiSession, id: string, body: Record<string, unknown>, hard?: boolean) {
    const suffix = hard ? "?hard=1" : "";
    return requestWithOfflineFallback(inquiryPath(id) + suffix, { method: "DELETE", body }, session);
  },

  convert(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(inquiryPath(id, "/convert"), { method: "POST", body }, session);
  }
};

import { request, requestWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const PAYOUTS_BASE = "/payouts";

function payoutPath(id: string, suffix = "") {
  return PAYOUTS_BASE + "/" + encodeURIComponent(id) + suffix;
}

export const payoutsClient = {
  basePath: PAYOUTS_BASE,

  list(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(PAYOUTS_BASE, params), null, session);
  },

  get(session: ApiSession, id: string) {
    return request(payoutPath(id), null, session);
  },

  pendingEmployees(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(PAYOUTS_BASE + "/pending-employees", params), null, session);
  },

  pending(session: ApiSession, params?: Record<string, string | number | boolean | undefined | null>) {
    return request(withQuery(PAYOUTS_BASE + "/pending", params), null, session);
  },

  ensure(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(PAYOUTS_BASE, { method: "POST", body }, session);
  },

  adjust(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(PAYOUTS_BASE + "/adjust", { method: "POST", body }, session);
  },

  setRate(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(PAYOUTS_BASE + "/set-rate", { method: "POST", body }, session);
  },

  recompute(session: ApiSession, id: string) {
    return requestWithOfflineFallback(payoutPath(id, "/recompute"), { method: "POST", body: {} }, session);
  },

  lock(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(payoutPath(id, "/lock"), { method: "POST", body }, session);
  },

  reopen(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(payoutPath(id, "/reopen"), { method: "POST", body }, session);
  },

  pay(session: ApiSession, body: Record<string, unknown>) {
    return requestWithOfflineFallback(PAYOUTS_BASE + "/pay", { method: "POST", body }, session);
  },

  payAdvance(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestWithOfflineFallback(payoutPath(id, "/pay-advance"), { method: "POST", body }, session);
  }
};

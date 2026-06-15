import { requestValidated, requestValidatedWithOfflineFallback } from "@/lib/api-client";
import type { ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  payoutDetailDtoSchema,
  payoutListResponseDtoSchema,
  payoutPendingEmployeesDtoSchema,
  payoutPendingForEmployeeDtoSchema,
  payoutRowDtoSchema,
} from "@/validation/payoutDto";

export const PAYOUTS_BASE = "/payouts";

function payoutPath(id: string, suffix = "") {
  return PAYOUTS_BASE + "/" + encodeURIComponent(id) + suffix;
}

export const payoutsClient = {
  basePath: PAYOUTS_BASE,

  list(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(PAYOUTS_BASE, params), null, session, payoutListResponseDtoSchema);
  },

  get(session: ApiSession, id: string) {
    return requestValidated(payoutPath(id), null, session, payoutDetailDtoSchema);
  },

  pendingEmployees(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(
      withQuery(PAYOUTS_BASE + "/pending-employees", params),
      null,
      session,
      payoutPendingEmployeesDtoSchema
    );
  },

  pending(
    session: ApiSession,
    params?: Record<string, string | number | boolean | undefined | null>
  ) {
    return requestValidated(withQuery(PAYOUTS_BASE + "/pending", params), null, session, payoutPendingForEmployeeDtoSchema);
  },

  ensure(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(PAYOUTS_BASE, { method: "POST", body }, session, payoutRowDtoSchema);
  },

  adjust(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(PAYOUTS_BASE + "/adjust", { method: "POST", body }, session, payoutRowDtoSchema);
  },

  setRate(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(PAYOUTS_BASE + "/set-rate", { method: "POST", body }, session, payoutDetailDtoSchema);
  },

  recompute(session: ApiSession, id: string) {
    return requestValidatedWithOfflineFallback(payoutPath(id, "/recompute"), { method: "POST", body: {} }, session, payoutRowDtoSchema);
  },

  lock(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(payoutPath(id, "/lock"), { method: "POST", body }, session, payoutRowDtoSchema);
  },

  reopen(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(payoutPath(id, "/reopen"), { method: "POST", body }, session, payoutRowDtoSchema);
  },

  pay(session: ApiSession, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(PAYOUTS_BASE + "/pay", { method: "POST", body }, session, payoutRowDtoSchema);
  },

  payAdvance(session: ApiSession, id: string, body: Record<string, unknown>) {
    return requestValidatedWithOfflineFallback(
      payoutPath(id, "/pay-advance"),
      { method: "POST", body },
      session,
      payoutRowDtoSchema
    );
  }
};

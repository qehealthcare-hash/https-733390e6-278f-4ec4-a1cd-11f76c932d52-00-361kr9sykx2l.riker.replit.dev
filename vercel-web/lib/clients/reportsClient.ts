import { request } from "@/lib/api-client";
import type { ApiRequestOptions, ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";

export const REPORTS_BASE = "/reports";

export const reportsClient = {
  dashboard(session: ApiSession, period: string, options?: ApiRequestOptions | null) {
    return request(
      REPORTS_BASE + "/dashboard?period=" + encodeURIComponent(period),
      options || null,
      session
    );
  },

  billingTotals(session: ApiSession, period: string) {
    return request(REPORTS_BASE + "/billing-totals?period=" + encodeURIComponent(period), null, session);
  },

  payoutTotals(session: ApiSession, period: string) {
    return request(REPORTS_BASE + "/payout-totals?period=" + encodeURIComponent(period), null, session);
  },

  profitLoss(session: ApiSession, period: string) {
    return request(REPORTS_BASE + "/profit-loss?period=" + encodeURIComponent(period), null, session);
  },

  payroll(session: ApiSession, period: string) {
    return request(REPORTS_BASE + "/payroll?period=" + encodeURIComponent(period), null, session);
  },

  inquiries(session: ApiSession, period: string, limit = 200) {
    return request(
      withQuery(REPORTS_BASE + "/inquiries", { period, limit }),
      null,
      session
    );
  },

  patients(session: ApiSession, period: string, limit = 200) {
    return request(withQuery(REPORTS_BASE + "/patients", { period, limit }), null, session);
  },

  attendance(session: ApiSession, period: string, limit = 200) {
    return request(withQuery(REPORTS_BASE + "/attendance", { period, limit }), null, session);
  },

  billings(session: ApiSession, period: string, limit = 200) {
    return request(withQuery(REPORTS_BASE + "/billings", { period, limit }), null, session);
  }
};

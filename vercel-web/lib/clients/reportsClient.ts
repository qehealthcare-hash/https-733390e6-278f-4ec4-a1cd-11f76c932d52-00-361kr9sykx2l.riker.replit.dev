import { requestValidated } from "@/lib/api-client";
import type { ApiRequestOptions, ApiSession } from "@/lib/clients/types";
import { withQuery } from "@/lib/clients/http";
import {
  billingTotalsReportDtoSchema,
  dashboardReportDtoSchema,
  payoutTotalsReportDtoSchema,
  payrollReportDtoSchema,
  profitLossReportDtoSchema,
  reportAttendanceSummaryResponseDtoSchema,
  reportBillingsSummaryResponseDtoSchema,
  reportInquiriesSummaryResponseDtoSchema,
  reportPatientsSummaryResponseDtoSchema,
} from "@/validation/reportDto";


export const REPORTS_BASE = "/reports";

export const reportsClient = {
  dashboard(session: ApiSession, period: string, options?: ApiRequestOptions | null) {
    return requestValidated(
      REPORTS_BASE + "/dashboard?period=" + encodeURIComponent(period),
      options || null,
      session,
      dashboardReportDtoSchema
    );
  },

  billingTotals(session: ApiSession, period: string) {
    return requestValidated(
      REPORTS_BASE + "/billing-totals?period=" + encodeURIComponent(period),
      null,
      session,
      billingTotalsReportDtoSchema
    );
  },

  payoutTotals(session: ApiSession, period: string) {
    return requestValidated(
      REPORTS_BASE + "/payout-totals?period=" + encodeURIComponent(period),
      null,
      session,
      payoutTotalsReportDtoSchema
    );
  },

  profitLoss(session: ApiSession, period: string) {
    return requestValidated(
      REPORTS_BASE + "/profit-loss?period=" + encodeURIComponent(period),
      null,
      session,
      profitLossReportDtoSchema
    );
  },

  payroll(session: ApiSession, period: string) {
    return requestValidated(
      REPORTS_BASE + "/payroll?period=" + encodeURIComponent(period),
      null,
      session,
      payrollReportDtoSchema
    );
  },

  inquiries(session: ApiSession, period: string, limit = 200) {
    return requestValidated(
      withQuery(REPORTS_BASE + "/inquiries", { period, limit }),
      null,
      session,
      reportInquiriesSummaryResponseDtoSchema
    );
  },

  patients(session: ApiSession, period: string, limit = 200) {
    return requestValidated(
      withQuery(REPORTS_BASE + "/patients", { period, limit }),
      null,
      session,
      reportPatientsSummaryResponseDtoSchema
    );
  },

  attendance(session: ApiSession, period: string, limit = 200) {
    return requestValidated(
      withQuery(REPORTS_BASE + "/attendance", { period, limit }),
      null,
      session,
      reportAttendanceSummaryResponseDtoSchema
    );
  },

  billings(session: ApiSession, period: string, limit = 200) {
    return requestValidated(
      withQuery(REPORTS_BASE + "/billings", { period, limit }),
      null,
      session,
      reportBillingsSummaryResponseDtoSchema
    );
  }
};

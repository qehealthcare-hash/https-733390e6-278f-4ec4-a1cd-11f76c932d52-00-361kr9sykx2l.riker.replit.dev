/**
 * Duty Calendar single-source-of-truth guards (tests I.4–I.10).
 *
 * Service + route layer: billing/payout/attendance cannot mutate duty-derived
 * ledger rows; receipts and disbursements stay on their own paths; duplicate
 * duties and manual amount overwrites are rejected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorCodes } from "@/types/common";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/mutationAudit", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildMutationAuditMock();
});
vi.mock("@/services/billingService", () => ({
  billingService: {
    replaceServiceEntries: vi.fn(),
    recordPayment: vi.fn().mockResolvedValue({ success: true, data: { id: "R1" } }),
    listReceiptsForBilling: vi.fn().mockResolvedValue({ success: true, data: [] })
  }
}));
vi.mock("@/services/payoutService", () => ({
  payoutService: {
    replacePayoutCharges: vi.fn(),
    markPaid: vi.fn().mockResolvedValue({ success: true, data: { id: "P1" } })
  }
}));
vi.mock("@/services/attendanceService", () => ({
  attendanceService: {
    mark: vi.fn().mockResolvedValue({ success: true, data: { id: "A1" } })
  }
}));
vi.mock("@/services/dutyService", () => ({
  dutyService: {
    create: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { billingService } from "@/services/billingService";
import { payoutService } from "@/services/payoutService";
import { dutyService } from "@/services/dutyService";
import { POST as SvcReplacePost } from "../../../app/api/v1/billings/svc-entries/replace/route";
import { POST as ReceiptsPost } from "../../../app/api/v1/billings/[id]/receipts/route";
import { POST as PayoutChargesReplacePost } from "../../../app/api/v1/payouts/charges/replace/route";
import { POST as PayoutPayPost } from "../../../app/api/v1/payouts/pay/route";
import { POST as AttendanceMarkPost } from "../../../app/api/v1/attendance/mark/route";

const billing = billingService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const payout = payoutService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const duty = dutyService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("duty-ledger guards I.4–I.10", () => {
  beforeEach(() => {
    setActor(null);
    vi.clearAllMocks();
  });

  it("I.4 billing cannot replace duty-calendar svc rows", async () => {
    billing.replaceServiceEntries.mockResolvedValue({
      success: false,
      error: "Duty-calendar charges are read-only here. Edit the duty in the Duty Calendar instead.",
      code: ErrorCodes.business
    });
    setActor(ACTORS.admin);
    const res = await SvcReplacePost(
      makeRequest("POST", "/api/v1/billings/svc-entries/replace", {
        body: {
          svc_key: "SK1",
          rows: [{ remarks: "duty:DTY1:2026-06-01:EMP1", total: 999 }]
        }
      }),
      ctx({})
    );
    await expectErrorEnvelope(res, 422, "business_rule_violation");
    expect(billing.replaceServiceEntries).toHaveBeenCalled();
  });

  it("I.5 payout cannot replace duty-calendar charge rows", async () => {
    payout.replacePayoutCharges.mockResolvedValue({
      success: false,
      error: "Duty-calendar payout charges are read-only here.",
      code: ErrorCodes.business
    });
    setActor(ACTORS.admin);
    const res = await PayoutChargesReplacePost(
      makeRequest("POST", "/api/v1/payouts/charges/replace", {
        body: {
          svc_key: "SK1",
          rows: [{ remarks: "duty:DTY1:2026-06-01:EMP1", amount: 500 }]
        }
      }),
      ctx({})
    );
    await expectErrorEnvelope(res, 422, "business_rule_violation");
  });

  it("I.6 attendance mark is denied for Staff (view-only module)", async () => {
    setActor(ACTORS.staff);
    const res = await AttendanceMarkPost(
      makeRequest("POST", "/api/v1/attendance/mark", {
        body: { employee_id: "EMP1", work_date: "2026-06-01", status: "PRESENT" }
      }),
      ctx({})
    );
    await expectErrorEnvelope(res, 403);
  });

  it("I.7 duplicate active duty creation surfaces duplicate failure", async () => {
    duty.create.mockResolvedValue({
      success: false,
      error: "Duplicate active duty assignment",
      code: ErrorCodes.duplicate
    });
    setActor(ACTORS.admin);
    const { POST: DutiesPost } = await import("../../../app/api/v1/duties/route");
    const res = await DutiesPost(
      makeRequest("POST", "/api/v1/duties", {
        body: {
          patient_id: "P1",
          employee_id: "E1",
          start_at: "2026-06-01",
          end_at: "2026-06-30"
        }
      }),
      ctx({})
    );
    await expectErrorEnvelope(res, 409);
  });

  it("I.8 billing replace with duty rows is blocked (manual overwrite)", async () => {
    billing.replaceServiceEntries.mockResolvedValue({
      success: false,
      error: "Duty-calendar charges are read-only here. Edit the duty in the Duty Calendar instead.",
      code: ErrorCodes.business
    });
    setActor(ACTORS.manager);
    const res = await SvcReplacePost(
      makeRequest("POST", "/api/v1/billings/svc-entries/replace", {
        body: { svc_key: "SK1", rows: [{ remarks: "duty:X:2026-06-01:E1", amt: 1, total: 9999 }] }
      }),
      ctx({})
    );
    await expectErrorEnvelope(res, 422, "business_rule_violation");
  });

  it("I.9 payment receipt entry allowed for Accountant on billing", async () => {
    setActor(ACTORS.accountant);
    const res = await ReceiptsPost(
      makeRequest("POST", "/api/v1/billings/BILL1/receipts", {
        body: { amount: 100, date: "2026-06-01", method: "UPI", type: "Receipt" }
      }),
      ctx({ id: "BILL1" })
    );
    await expectCreatedEnvelope(res);
    expect(billing.recordPayment).toHaveBeenCalled();
  });

  it("I.10 disbursement entry allowed for Accountant on payout pay route", async () => {
    setActor(ACTORS.accountant);
    const res = await PayoutPayPost(
      makeRequest("POST", "/api/v1/payouts/pay", {
        body: {
          payout_id: "PAY1",
          amount: 100,
          proof_bucket: "payout-proofs",
          proof_path: "2026-06/slip.jpg"
        }
      }),
      ctx({})
    );
    await expectOkEnvelope(res);
    expect(payout.markPaid).toHaveBeenCalled();
  });

  it("I.10 Accountant cannot ensure/create payout rows (disbursement-only)", async () => {
    setActor(ACTORS.accountant);
    const { POST: PayoutsPost } = await import("../../../app/api/v1/payouts/route");
    const res = await PayoutsPost(
      makeRequest("POST", "/api/v1/payouts", { body: { employee_id: "EMP1", period_month: "2026-06" } }),
      ctx({})
    );
    await expectErrorEnvelope(res, 403);
  });
});

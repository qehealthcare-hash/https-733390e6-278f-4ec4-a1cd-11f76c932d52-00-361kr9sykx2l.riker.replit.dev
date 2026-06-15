/**
 * Cross-route E2E lifecycle tests.
 *
 * These run multiple HTTP-layer route handlers in sequence with consistent
 * mocked service responses to prove that the routing, RBAC, envelope, and
 * audit wiring all hold together for full operator journeys:
 *
 *   1. Patient → Billing → Monthly invoice → Receipt → Close bill
 *   2. Duty creation → Cancel
 *   3. Invoice deletion compaction → fresh monthly invoice
 *
 * The service layer is mocked because the existing unit suites already
 * exercise business rules. The goal here is to lock in the HTTP wiring
 * across routes so a refactor that breaks one stage cannot ship green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/supabase", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildSupabaseMock();
});
vi.mock("@/services/mutationAudit", async () => {
  const harness = await import("@/test/routeHarness");
  return harness.buildMutationAuditMock();
});
vi.mock("@/services/patientService", () => ({
  patientService: {
    create: vi.fn(),
    getById: vi.fn()
  }
}));
vi.mock("@/services/billingService", () => ({
  billingService: {
    create: vi.fn(),
    listByPatient: vi.fn(),
    listInvoices: vi.fn(),
    generateInvoice: vi.fn(),
    cancelInvoice: vi.fn(),
    recordPayment: vi.fn(),
    close: vi.fn()
  }
}));
vi.mock("@/services/dutyService", () => ({
  dutyService: {
    create: vi.fn(),
    cancel: vi.fn()
  }
}));

import {
  ACTORS,
  ctx,
  expectCreatedEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";
import { dutyDetailFixture } from "@/test/dutyDetailFixture";
import { patientService } from "@/services/patientService";
import { billingService } from "@/services/billingService";
import { dutyService } from "@/services/dutyService";

import { POST as PatientsPost } from "../../../app/api/v1/patients/route";
import { POST as BillingsPost } from "../../../app/api/v1/billings/route";
import { POST as InvoicesPost } from "../../../app/api/v1/billings/[id]/invoices/route";
import { DELETE as InvoiceDelete } from "../../../app/api/v1/billings/[id]/invoices/[invoiceId]/route";
import { POST as ReceiptsPost } from "../../../app/api/v1/billings/[id]/receipts/route";
import { POST as BillingClose } from "../../../app/api/v1/billings/[id]/close/route";
import { POST as DutiesPost } from "../../../app/api/v1/duties/route";
import { POST as DutyCancelPost } from "../../../app/api/v1/duties/[id]/cancel/route";

const pat = patientService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const bil = billingService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const dut = dutyService as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("E2E lifecycle — patient → bill → invoice → receipt → close", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("completes the full happy-path from patient creation to bill closure", async () => {
    setActor(ACTORS.admin);

    // 1. Create patient
    pat.create.mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Anita", status: "Active" }
    });
    const patientRes = await PatientsPost(
      makeRequest("POST", "/api/v1/patients", {
        body: { name: "Anita", mobile: "9000000010" }
      }),
      ctx({})
    );
    const patient = await expectCreatedEnvelope<{ id: string }>(patientRes);
    expect(patient.id).toBe("PAT1");

    // 2. Create billing record
    bil.create.mockResolvedValue({
      success: true,
      data: { id: "BILL1", patient_id: patient.id, status: "Active" }
    });
    const billingRes = await BillingsPost(
      makeRequest("POST", "/api/v1/billings", {
        body: { patient_id: patient.id, period: "2026-05" }
      }),
      ctx({})
    );
    const billing = await expectCreatedEnvelope<{ id: string }>(billingRes);
    expect(billing.id).toBe("BILL1");
    expect(bil.create).toHaveBeenCalledWith(
      { patient_id: "PAT1", period: "2026-05" },
      expect.any(Object)
    );

    // 3. Generate monthly invoice
    bil.generateInvoice.mockResolvedValue({
      success: true,
      data: { id: "INV1", invoice_no: 1, status: "UNPAID", amount: 15000 }
    });
    const invoiceRes = await InvoicesPost(
      makeRequest("POST", `/api/v1/billings/${billing.id}/invoices`, {
        body: { kind: "MONTHLY", period: "2026-05" }
      }),
      ctx({ id: billing.id })
    );
    const invoice = await expectCreatedEnvelope<{ id: string; invoice_no: number; amount: number }>(
      invoiceRes
    );
    expect(invoice.invoice_no).toBe(1);
    expect(bil.generateInvoice).toHaveBeenCalledWith(
      { kind: "MONTHLY", period: "2026-05", billing_id: "BILL1" },
      expect.any(Object)
    );

    // 4. Record receipt against the invoice
    bil.recordPayment.mockResolvedValue({
      success: true,
      data: { id: "RCT1", invoice_id: "INV1", amount: 15000 }
    });
    const receiptRes = await ReceiptsPost(
      makeRequest("POST", `/api/v1/billings/${billing.id}/receipts`, {
        body: { amount: 15000, invoice_id: invoice.id, mode: "UPI" }
      }),
      ctx({ id: billing.id })
    );
    const receipt = await expectCreatedEnvelope<{ id: string; amount: number }>(receiptRes);
    expect(receipt.amount).toBe(15000);
    expect(bil.recordPayment).toHaveBeenCalledWith(
      { amount: 15000, invoice_id: "INV1", mode: "UPI", billing_id: "BILL1" },
      expect.any(Object)
    );

    // 5. Close the bill (zero outstanding now)
    bil.close.mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Closed", outstanding: 0 }
    });
    const closeRes = await BillingClose(
      makeRequest("POST", `/api/v1/billings/${billing.id}/close`, {
        body: { reason: "fully paid", expected_updated_at: "2026-05-28T10:00:00.000Z" }
      }),
      ctx({ id: billing.id })
    );
    expect(bil.close).toHaveBeenCalledWith(
      "BILL1",
      expect.objectContaining({
        reason: "fully paid",
        expected_updated_at: "2026-05-28T10:00:00.000Z"
      }),
      expect.any(Object)
    );
    const closed = await expectOkEnvelope<{ status: string }>(closeRes);
    expect(closed.status).toBe("Closed");
  });

  it("blocks closing a bill with outstanding > 0 and reopens only with force", async () => {
    setActor(ACTORS.manager);
    bil.close.mockResolvedValueOnce({
      success: false,
      code: "business_rule_violation",
      error: "Outstanding > 0"
    });
    const res1 = await BillingClose(
      makeRequest("POST", "/api/v1/billings/BILL1/close", {
        body: { reason: "x" }
      }),
      ctx({ id: "BILL1" })
    );
    expect(res1.status).toBe(422);

    setActor(ACTORS.admin);
    bil.close.mockResolvedValueOnce({
      success: true,
      data: { id: "BILL1", status: "Closed" }
    });
    const res2 = await BillingClose(
      makeRequest("POST", "/api/v1/billings/BILL1/close", {
        body: { reason: "write-off", force: true }
      }),
      ctx({ id: "BILL1" })
    );
    await expectOkEnvelope(res2);
    expect(bil.close).toHaveBeenLastCalledWith(
      "BILL1",
      { reason: "write-off", force: true },
      expect.any(Object)
    );
  });
});

describe("E2E lifecycle — duty creation and cancellation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActor(ACTORS.admin);
  });

  it("creates a duty, then cancels it, with the appropriate roles", async () => {
    dut.create.mockResolvedValue({
      success: true,
      data: dutyDetailFixture({ id: "DUTY1" })
    });
    const createRes = await DutiesPost(
      makeRequest("POST", "/api/v1/duties", {
        body: {
          patient_id: "PAT1",
          employee_id: "EMP1",
          start_at: "2026-05-25T08:00:00Z",
          end_at: "2026-05-26T08:00:00Z",
          service_name: "Care Taker",
          shift_type: "DAY",
          charge_per_day: 500,
          payout_per_day: 300
        }
      }),
      ctx({})
    );
    const duty = await expectCreatedEnvelope<{ id: string; status: string }>(createRes);
    expect(duty.id).toBe("DUTY1");
    expect(duty.status).toBe("SCHEDULED");

    dut.cancel.mockResolvedValue({
      success: true,
      data: dutyDetailFixture({ id: "DUTY1", status: "CANCELLED" })
    });
    const cancelRes = await DutyCancelPost(
      makeRequest("POST", `/api/v1/duties/${duty.id}/cancel`, {
        body: { reason: "client requested" }
      }),
      ctx({ id: duty.id })
    );
    const cancelled = await expectOkEnvelope<{ status: string }>(cancelRes);
    expect(cancelled.status).toBe("CANCELLED");
    expect(dut.cancel).toHaveBeenCalledWith(
      "DUTY1",
      { reason: "client requested" },
      expect.any(Object)
    );
  });

  it("refuses to cancel after receipts already recorded against the duty", async () => {
    dut.cancel.mockResolvedValue({
      success: false,
      code: "conflict",
      error: "Receipts already recorded against this duty"
    });
    const res = await DutyCancelPost(
      makeRequest("POST", "/api/v1/duties/DUTY1/cancel", {
        body: { reason: "x" }
      }),
      ctx({ id: "DUTY1" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("conflict");
  });
});

describe("E2E lifecycle — invoice generate → delete → regenerate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActor(ACTORS.accountant);
  });

  it("generates a monthly invoice, deletes it, then generates a fresh one with a renumbered seq", async () => {
    bil.generateInvoice.mockResolvedValueOnce({
      success: true,
      data: { id: "INV1", invoice_no: 5, status: "UNPAID" }
    });
    const genRes1 = await InvoicesPost(
      makeRequest("POST", "/api/v1/billings/BILL1/invoices", {
        body: { kind: "MONTHLY", period: "2026-05" }
      }),
      ctx({ id: "BILL1" })
    );
    const inv1 = await expectCreatedEnvelope<{ invoice_no: number }>(genRes1);
    expect(inv1.invoice_no).toBe(5);

    bil.cancelInvoice.mockResolvedValueOnce({
      success: true,
      data: { id: "INV1", removed: true, receipts_detached: 0, sequence_compacted: true }
    });
    const delRes = await InvoiceDelete(
      makeRequest("DELETE", "/api/v1/billings/BILL1/invoices/INV1"),
      ctx({ id: "BILL1", invoiceId: "INV1" })
    );
    const deleted = await expectOkEnvelope<{
      removed: boolean;
      sequence_compacted: boolean;
    }>(delRes);
    expect(deleted.removed).toBe(true);
    expect(deleted.sequence_compacted).toBe(true);

    // The compacted sequence means the *next* invoice for any billing keeps
    // numbering flowing without a gap.
    bil.generateInvoice.mockResolvedValueOnce({
      success: true,
      data: { id: "INV2", invoice_no: 5, status: "UNPAID" }
    });
    const genRes2 = await InvoicesPost(
      makeRequest("POST", "/api/v1/billings/BILL1/invoices", {
        body: { kind: "MONTHLY", period: "2026-05" }
      }),
      ctx({ id: "BILL1" })
    );
    const inv2 = await expectCreatedEnvelope<{ invoice_no: number }>(genRes2);
    // Sequence was compacted; the freshly-generated invoice re-claims the slot.
    expect(inv2.invoice_no).toBe(5);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "@/types/common";
import { billingService } from "@/services/billingService";
import { billingRepository } from "@/database/billingRepository";
import { patientRepository } from "@/database/patientRepository";
import {
  billingPeriodsFromDates,
  invoiceOutstanding
} from "@/business/billingRules";

vi.mock("@/database/billingRepository");
vi.mock("@/database/patientRepository");
vi.mock("@/database/dutyRepository");
vi.mock("@/services/mutationAudit", () => ({
  writeMutationAudit: vi.fn().mockResolvedValue({ success: true, data: null }),
  finalizeWithAudit: vi.fn((_audit, data) => ({ success: true, data }))
}));

const ctx = { actor: { email: "acct@test.com", accessToken: "tok" } };

describe("billingRules — invoice helpers", () => {
  it("extracts unique YYYY-MM periods from dates", () => {
    expect(billingPeriodsFromDates(["2026-05-01", "2026-05-25", "2026-06-01"])).toEqual([
      "2026-05",
      "2026-06"
    ]);
  });

  it("computes invoice outstanding", () => {
    expect(invoiceOutstanding(18750, 5000)).toBe(13750);
    expect(invoiceOutstanding(100, 150)).toBe(0);
  });
});

describe("billingService — invoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recordPayment rejects amount over invoice outstanding", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1" }
    });
    vi.mocked(billingRepository.loadBillingBundle).mockResolvedValue({
      success: true,
      data: {
        billing: { id: "BILL1", status: "Active", patient_id: "PAT1", sec_dep: 0 },
        services: [{ total: 2000 }],
        receipts: [{ amount: 400 }]
      }
    });
    vi.mocked(patientRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Test Patient" }
    });
    vi.mocked(billingRepository.listInvoicesByBilling).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(billingRepository.findInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: "IV1",
        billing_id: "BILL1",
        invoice_no: "INV2026000001",
        amount: 1000,
        status: "UNPAID"
      }
    });
    vi.mocked(billingRepository.listReceiptsByInvoice).mockResolvedValue({
      success: true,
      data: [{ amount: 400 }]
    });

    const result = await billingService.recordPayment(
      {
        billing_id: "BILL1",
        invoice_id: "IV1",
        amount: 700,
        date: "2026-05-25",
        type: "Advance",
        method: "Cash"
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe(ErrorCodes.business);
  });

  it("cancelInvoice uses RPC and refuses PAID from server", async () => {
    vi.mocked(billingRepository.findInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: "IV1",
        billing_id: "BILL1",
        invoice_no: "INV2026000001",
        status: "PAID"
      }
    });
    vi.mocked(billingRepository.deleteInvoiceRpc).mockResolvedValue({
      success: true,
      data: {
        ok: false,
        code: "BUSINESS",
        message: "Cannot delete a PAID invoice — void receipts first"
      }
    });

    const result = await billingService.cancelInvoice("IV1", ctx);
    expect(result.success).toBe(false);
    expect(result.code).toBe(ErrorCodes.business);
  });

  it("cancelInvoice succeeds via RPC and recomputes bill paid_status", async () => {
    vi.mocked(billingRepository.findInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: "IV1",
        billing_id: "BILL1",
        invoice_no: "INV2026000001",
        status: "UNPAID"
      }
    });
    vi.mocked(billingRepository.deleteInvoiceRpc).mockResolvedValue({
      success: true,
      data: {
        ok: true,
        invoice_no: "INV2026000001",
        billing_id: "BILL1",
        receipts_detached: 1
      }
    });

    vi.mocked(billingRepository.loadBillingBundle).mockResolvedValue({
      success: true,
      data: {
        billing: { id: "BILL1", patient_id: "PAT1", sec_dep: 0, paid_status: "PARTIAL" },
        services: [{ total: 1000 }],
        receipts: [{ amount: 500 }]
      }
    });
    vi.mocked(billingRepository.listInvoicesByBilling).mockResolvedValue({
      success: true,
      data: []
    });
    vi.mocked(patientRepository.findById).mockResolvedValue({
      success: true,
      data: { id: "PAT1", name: "Test Patient" }
    });
    vi.mocked(billingRepository.updateBilling).mockResolvedValue({
      success: true,
      data: { id: "BILL1", paid_status: "PARTIAL" }
    });

    const result = await billingService.cancelInvoice("IV1", ctx);
    expect(result.success).toBe(true);
    expect(result.data?.receipts_detached).toBe(1);
    expect(billingRepository.deleteInvoiceRpc).toHaveBeenCalledWith(
      "IV1",
      "acct@test.com",
      expect.anything()
    );
  });

  it("generateInvoice MONTHLY returns duplicate when period exists", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1" }
    });
    vi.mocked(billingRepository.findInvoiceForPeriod).mockResolvedValue({
      success: true,
      data: {
        id: "IV_EXIST",
        billing_id: "BILL1",
        invoice_no: "INV2026000001",
        kind: "MONTHLY",
        period: "2026-05",
        amount: 7500,
        status: "UNPAID"
      }
    });
    vi.mocked(billingRepository.listInvoiceLines).mockResolvedValue({
      success: true,
      data: [{ date: "2026-05-01", total: 750 }]
    });

    const result = await billingService.generateInvoice(
      { billing_id: "BILL1", kind: "MONTHLY", period: "2026-05" },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.data?.duplicate).toBe(true);
    expect(result.data?.invoice.id).toBe("IV_EXIST");
  });

  it("generateFinalInvoice applies deposit as Security receipt (invoice at gross)", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1", sec_dep: 5000 }
    });
    vi.mocked(billingRepository.generateFinalInvoiceRpc).mockResolvedValue({
      success: true,
      data: {
        invoice_id: "IV_FINAL_1",
        invoice_no: "INV2026000010",
        duplicate: false,
        security_receipt_id: "RCP_SEC_1",
        refund_id: null,
        refund_amount: 0,
        sec_dep_applied: 5000,
        gross: 18750,
        net: 13750,
        line_count: 25
      }
    });
    vi.mocked(billingRepository.findInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: "IV_FINAL_1",
        billing_id: "BILL1",
        invoice_no: "INV2026000010",
        kind: "FINAL",
        amount: 18750,
        status: "UNPAID"
      }
    });
    vi.mocked(billingRepository.listInvoiceLines).mockResolvedValue({
      success: true,
      data: [{ date: "2026-05-01", service_name: "Care", total: 750 }]
    });

    const result = await billingService.generateFinalInvoice(
      { billing_id: "BILL1" },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.data?.invoice.kind).toBe("FINAL");
    expect(result.data?.invoice.amount).toBe(18750);
    expect(result.data?.security_receipt_id).toBe("RCP_SEC_1");
    expect(result.data?.net).toBe(13750);
    expect(result.data?.sec_dep_applied).toBe(5000);
    expect(result.data?.lines.every((l) => Number(l.total) >= 0)).toBe(true);
  });

  it("generateFinalInvoice surfaces refund when deposit exceeds gross", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active", patient_id: "PAT1", sec_dep: 25000 }
    });
    vi.mocked(billingRepository.generateFinalInvoiceRpc).mockResolvedValue({
      success: true,
      data: {
        invoice_id: "IV_FINAL_2",
        invoice_no: "INV2026000011",
        duplicate: false,
        security_receipt_id: "RCP_SEC_2",
        refund_id: "RCP_REFUND_1",
        refund_amount: 6250,
        sec_dep_applied: 18750,
        gross: 18750,
        net: 0,
        line_count: 25
      }
    });
    vi.mocked(billingRepository.findInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: "IV_FINAL_2",
        billing_id: "BILL1",
        invoice_no: "INV2026000011",
        kind: "FINAL",
        amount: 18750,
        status: "UNPAID"
      }
    });
    vi.mocked(billingRepository.listInvoiceLines).mockResolvedValue({
      success: true,
      data: []
    });

    const result = await billingService.generateFinalInvoice(
      { billing_id: "BILL1" },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.data?.refund_id).toBe("RCP_REFUND_1");
    expect(result.data?.refund_amount).toBe(6250);
    expect(result.data?.net).toBe(0);
  });

  it("generateFinalInvoice refuses when bill is Cancelled", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Cancelled", patient_id: "PAT1", sec_dep: 5000 }
    });

    const result = await billingService.generateFinalInvoice(
      { billing_id: "BILL1" },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe(ErrorCodes.business);
    expect(billingRepository.generateFinalInvoiceRpc).not.toHaveBeenCalled();
  });

  it("generateFinalInvoice ALLOWS Closed bill (retroactive recovery path)", async () => {
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Closed", patient_id: "PAT1", sec_dep: 5000 }
    });
    vi.mocked(billingRepository.generateFinalInvoiceRpc).mockResolvedValue({
      success: true,
      data: {
        invoice_id: "IV_FINAL_R1",
        invoice_no: "INV2026000099",
        duplicate: false,
        security_receipt_id: "RCP_SEC_R1",
        refund_id: null,
        refund_amount: 0,
        sec_dep_applied: 5000,
        gross: 25300,
        net: 20300,
        line_count: 35
      }
    });
    vi.mocked(billingRepository.findInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: "IV_FINAL_R1",
        billing_id: "BILL1",
        invoice_no: "INV2026000099",
        kind: "FINAL",
        amount: 25300,
        status: "UNPAID"
      }
    });
    vi.mocked(billingRepository.listInvoiceLines).mockResolvedValue({
      success: true,
      data: []
    });

    const result = await billingService.generateFinalInvoice(
      { billing_id: "BILL1" },
      ctx
    );
    expect(result.success).toBe(true);
    expect(result.data?.invoice.kind).toBe("FINAL");
    expect(billingRepository.generateFinalInvoiceRpc).toHaveBeenCalled();
  });

  it("regenerateInvoice refuses when receipts exist", async () => {
    vi.mocked(billingRepository.findInvoiceById).mockResolvedValue({
      success: true,
      data: {
        id: "IV1",
        billing_id: "BILL1",
        kind: "MONTHLY",
        period: "2026-05",
        invoice_no: "INV2026000001",
        amount: 7500,
        status: "PARTIAL"
      }
    });
    vi.mocked(billingRepository.findBillingById).mockResolvedValue({
      success: true,
      data: { id: "BILL1", status: "Active" }
    });
    vi.mocked(billingRepository.listReceiptsByInvoice).mockResolvedValue({
      success: true,
      data: [{ amount: 1000 }]
    });

    const result = await billingService.regenerateInvoice("IV1", ctx);
    expect(result.success).toBe(false);
    expect(result.code).toBe(ErrorCodes.business);
  });
});

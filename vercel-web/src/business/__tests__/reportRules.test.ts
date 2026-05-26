import { describe, expect, it } from "vitest";
import {
  buildBillingTotals,
  buildDashboardKpis,
  buildPayoutTotals,
  buildProfitLoss,
  receiptInYmdRange
} from "@/business/reportRules";

describe("reportRules — test matrix", () => {
  it("buildDashboardKpis matches service, receipt, and payout math", () => {
    const kpis = buildDashboardKpis(
      "2026-05",
      { from: "2026-05-01T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
      {
        patients_total: 10,
        patients_active: 7,
        employees_total: 5,
        employees_active: 4,
        inquiries_this_month: 3,
        duties_active: 2,
        duties_scheduled: 1,
        duties_completed: 8,
        duties_cancelled: 1,
        billings_total: 9,
        billings_open: 6,
        billings_closed: 3,
        service_rows: [{ total: 1000 }, { total: 500 }],
        receipt_rows: [{ amount: 1200 }],
        payout_rows: [
          { net_amount: 800, gross_amount: 900, status: "PAID" },
          { net_amount: 200, gross_amount: 250, status: "OPEN" }
        ],
        payout_charge_rows: [{ amount: 150 }]
      }
    );

    expect(kpis.billing_total_amount).toBe(1500);
    expect(kpis.billing_collected_amount).toBe(1200);
    expect(kpis.billing_pending_amount).toBe(300);
    expect(kpis.payout_total_amount).toBe(1000);
    expect(kpis.payout_paid_amount).toBe(800);
    expect(kpis.payout_pending_amount).toBe(350);
    expect(kpis.partner_charge_ledger).toBe(150);
    expect(kpis.profit_loss).toBe(400);
  });

  it("buildProfitLoss aligns with dashboard profit definition", () => {
    const pl = buildProfitLoss(
      "2026-05",
      { from: "2026-05-01T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
      {
        receipts: [{ amount: 1200 }],
        payouts: [
          { net_amount: 800, status: "PAID" },
          { net_amount: 200, status: "OPEN" }
        ],
        payout_charges: [{ amount: 100 }]
      }
    );

    expect(pl.revenue).toBe(1200);
    expect(pl.payouts_paid).toBe(800);
    expect(pl.partner_charge_ledger).toBe(100);
    expect(pl.payouts_pending).toBe(300);
    expect(pl.net_profit).toBe(400);
    expect(pl.net_profit_after_pending_payouts).toBe(100);
  });

  it("buildBillingTotals counts billings with period activity only", () => {
    const report = buildBillingTotals(
      "2026-05",
      { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
      {
        billings: [
          { id: "b1", status: "Active" },
          { id: "b2", status: "Closed" }
        ],
        services: [{ billing_id: "b1", total: 500 }],
        receipts: [{ billing_id: "b2", amount: 200 }]
      }
    );
    expect(report.billings_count).toBe(2);
    expect(report.service_total).toBe(500);
    expect(report.collected).toBe(200);
    expect(report.byStatus.Active?.count).toBe(1);
    expect(report.byStatus.Closed?.count).toBe(1);
  });

  it("buildPayoutTotals includes partner charge ledger in pending", () => {
    const totals = buildPayoutTotals(
      "2026-05",
      { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
      [{ net_amount: 500, gross_amount: 600, status: "OPEN" }],
      [{ amount: 75 }]
    );
    expect(totals.net).toBe(500);
    expect(totals.pending).toBe(575);
    expect(totals.partner_charge_ledger).toBe(75);
  });

  it("receiptInYmdRange prefers business date over created_at", () => {
    expect(
      receiptInYmdRange(
        { date: "2026-04-30", created_at: "2026-05-15T10:00:00.000Z" },
        "2026-05-01",
        "2026-06-01",
        "2026-05-01T00:00:00.000Z",
        "2026-06-01T00:00:00.000Z"
      )
    ).toBe(false);
    expect(
      receiptInYmdRange(
        { date: "", created_at: "2026-05-15T10:00:00.000Z" },
        "2026-05-01",
        "2026-06-01",
        "2026-05-01T00:00:00.000Z",
        "2026-06-01T00:00:00.000Z"
      )
    ).toBe(true);
  });
});

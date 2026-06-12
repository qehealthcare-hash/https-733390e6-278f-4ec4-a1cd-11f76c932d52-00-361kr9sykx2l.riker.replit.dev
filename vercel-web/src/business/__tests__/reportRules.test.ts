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
          { employee_id: "EMP1", net_amount: 800, gross_amount: 900, status: "PAID" },
          { employee_id: "EMP2", net_amount: 200, gross_amount: 250, status: "OPEN" }
        ],
        payout_charge_rows: [{ partner_id: "EMP3", amount: 150 }]
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
    // M3-H4: conservative profit (collected − net payouts − partner charges)
    //   = 1200 − 1000 − 150 = 50
    // and must match `buildProfitLoss().net_profit_after_pending_payouts`
    // for the same inputs.
    expect(kpis.profit_loss_after_pending).toBe(50);
  });

  it("dashboard `profit_loss_after_pending` matches buildProfitLoss for identical inputs (M3-H4 parity)", () => {
    const receipts = [{ amount: 5000 }, { amount: 250 }];
    const payouts = [
      { employee_id: "EMP1", net_amount: 1800, gross_amount: 2000, status: "PAID" },
      { employee_id: "EMP2", net_amount: 1200, gross_amount: 1300, status: "OPEN" },
      { employee_id: "EMP3", net_amount: 400, gross_amount: 450, status: "OPEN" }
    ];
    const payoutCharges = [{ partner_id: "EMP4", amount: 120 }];

    const kpis = buildDashboardKpis(
      "2026-05",
      { from: "2026-05-01T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
      {
        patients_total: 0,
        patients_active: 0,
        employees_total: 0,
        employees_active: 0,
        inquiries_this_month: 0,
        duties_active: 0,
        duties_scheduled: 0,
        duties_completed: 0,
        duties_cancelled: 0,
        billings_total: 0,
        billings_open: 0,
        billings_closed: 0,
        service_rows: [],
        receipt_rows: receipts,
        payout_rows: payouts,
        payout_charge_rows: payoutCharges
      }
    );

    const pl = buildProfitLoss(
      "2026-05",
      { from: "2026-05-01T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
      { receipts, payouts, payout_charges: payoutCharges }
    );

    // Cash-basis profit must agree:
    expect(kpis.profit_loss).toBe(pl.net_profit);
    // Accrual variant must agree:
    expect(kpis.profit_loss_after_pending).toBe(pl.net_profit_after_pending_payouts);
  });

  it("buildProfitLoss aligns with dashboard profit definition", () => {
    const pl = buildProfitLoss(
      "2026-05",
      { from: "2026-05-01T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
      {
        receipts: [{ amount: 1200 }],
        payouts: [
          { employee_id: "EMP1", net_amount: 800, status: "PAID" },
          { employee_id: "EMP2", net_amount: 200, status: "OPEN" }
        ],
        payout_charges: [{ partner_id: "EMP3", amount: 100 }]
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
      [{ employee_id: "EMP1", net_amount: 500, gross_amount: 600, status: "OPEN" }],
      [{ partner_id: "EMP2", amount: 75 }]
    );
    expect(totals.net).toBe(500);
    expect(totals.pending).toBe(575);
    expect(totals.partner_charge_ledger).toBe(75);
  });

  it("does not double count duty-calendar charges already represented by payout rows", () => {
    const range = { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" };
    const payouts = [
      { employee_id: "EMP1", net_amount: 500, gross_amount: 500, status: "OPEN" }
    ];
    const charges = [
      { partner_id: "EMP1", amount: 500 },
      { partner_id: "EMP2", amount: 75 }
    ];

    const payoutTotals = buildPayoutTotals("2026-05", range, payouts, charges);
    expect(payoutTotals.partner_charge_ledger).toBe(575);
    expect(payoutTotals.pending).toBe(575);

    const pl = buildProfitLoss("2026-05", range, {
      receipts: [{ amount: 1000 }],
      payouts,
      payout_charges: charges
    });
    expect(pl.payouts_pending).toBe(575);
    expect(pl.net_profit_after_pending_payouts).toBe(425);
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

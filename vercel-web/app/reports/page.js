"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { useAuth } from "@/components/providers/auth-provider";
import { request } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency } from "@/lib/formatters";

export default function ReportsPage() {
  var auth = useAuth();
  var [data, setData] = useState({
    patientBilling: [],
    employeePayout: [],
    profitLoss: [],
    inquiryConversion: [],
    attendanceService: []
  });
  var [rangeMode, setRangeMode] = useState("all");
  var [filterMonth, setFilterMonth] = useState("");

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      Promise.all([
        request("/reports/patient-billing", null, auth.session),
        request("/reports/employee-payout", null, auth.session),
        request("/reports/profit-loss", null, auth.session),
        request("/reports/inquiry-conversion", null, auth.session),
        request("/reports/attendance-service", null, auth.session)
      ]).then(function (result) {
        setData({
          patientBilling: result[0],
          employeePayout: result[1],
          profitLoss: result[2],
          inquiryConversion: result[3],
          attendanceService: result[4]
        });
      });
    },
    [auth.session]
  );

  var filteredProfit = useMemo(
    function () {
      return data.profitLoss.filter(function (row) {
        if (!filterMonth) return true;
        return String(row.month_key || "").indexOf(filterMonth) === 0;
      });
    },
    [data.profitLoss, filterMonth]
  );

  var totals = useMemo(
    function () {
      var revenue = data.patientBilling.reduce(function (sum, row) {
        return sum + Number(row.total_collected || 0);
      }, 0);
      var pendingPayout = data.employeePayout.reduce(function (sum, row) {
        return sum + Number(row.total_pending || 0);
      }, 0);
      var openReceivables = data.patientBilling.reduce(function (sum, row) {
        return sum + Number(row.outstanding_amount || 0);
      }, 0);
      return {
        revenue: revenue,
        pendingPayout: pendingPayout,
        openReceivables: openReceivables
      };
    },
    [data.patientBilling, data.employeePayout]
  );

  return (
    <AuthGuard permission="reports.read">
      <AppShell title="Reports">
        <div className="page-grid">
          <section className="kpi-grid">
            <StatCard label="Collections to Date" value={formatCurrency(totals.revenue)} detail="Patient receipts and realized collections" />
            <StatCard label="Open Patient Receivables" value={formatCurrency(totals.openReceivables)} detail="Still due from invoice history" />
            <StatCard label="Pending Staff Payouts" value={formatCurrency(totals.pendingPayout)} detail="Unpaid payroll obligations" />
          </section>

          <ModuleShell
            title="Report Controls"
            description="Monthly, yearly, or custom exporting can be layered on top of these views"
            actions={
              <div className="button-row">
                <button className="button secondary" type="button" onClick={function () { downloadCsv("profit-loss-report.csv", filteredProfit); }}>
                  Export Profit & Loss CSV
                </button>
              </div>
            }
          >
            <div className="toolbar">
              <div className="field">
                <label>Range Mode</label>
                <select value={rangeMode} onChange={function (event) { setRangeMode(event.target.value); }}>
                  <option value="all">All time</option>
                  <option value="monthly">Monthly focus</option>
                  <option value="yearly">Yearly focus</option>
                  <option value="custom">Custom month filter</option>
                </select>
              </div>
              <div className="field">
                <label>Month Key Filter</label>
                <input value={filterMonth} onChange={function (event) { setFilterMonth(event.target.value); }} placeholder="2026-05" />
              </div>
            </div>
          </ModuleShell>

          <ModuleShell
            title="Patient Billing Report"
            actions={<button className="button secondary" type="button" onClick={function () { downloadCsv("patient-billing-report.csv", data.patientBilling); }}>Export CSV</button>}
          >
            <DataTable
              columns={[
                { key: "patient_name", label: "Patient" },
                { key: "total_billed", label: "Billed", render: function (row) { return formatCurrency(row.total_billed); } },
                { key: "total_collected", label: "Collected", render: function (row) { return formatCurrency(row.total_collected); } },
                { key: "outstanding_amount", label: "Outstanding", render: function (row) { return formatCurrency(row.outstanding_amount); } },
                { key: "security_deposit", label: "Deposit Held", render: function (row) { return formatCurrency(row.security_deposit); } }
              ]}
              rows={data.patientBilling}
            />
          </ModuleShell>

          <ModuleShell
            title="Employee Payout Report"
            actions={<button className="button secondary" type="button" onClick={function () { downloadCsv("employee-payout-report.csv", data.employeePayout); }}>Export CSV</button>}
          >
            <DataTable
              columns={[
                { key: "employee_name", label: "Employee" },
                { key: "total_paid", label: "Paid", render: function (row) { return formatCurrency(row.total_paid); } },
                { key: "total_pending", label: "Pending", render: function (row) { return formatCurrency(row.total_pending); } }
              ]}
              rows={data.employeePayout}
            />
          </ModuleShell>

          <ModuleShell
            title="Profit & Loss Statement"
            actions={<button className="button secondary" type="button" onClick={function () { downloadCsv("profit-loss.csv", filteredProfit); }}>Export CSV</button>}
          >
            <DataTable
              columns={[
                { key: "month_key", label: "Month" },
                { key: "total_revenue", label: "Revenue", render: function (row) { return formatCurrency(row.total_revenue); } },
                { key: "total_expense", label: "Expense", render: function (row) { return formatCurrency(row.total_expense); } },
                { key: "net_profit", label: "Net", render: function (row) { return formatCurrency(row.net_profit); } }
              ]}
              rows={filteredProfit}
            />
          </ModuleShell>

          <ModuleShell
            title="Inquiry Conversion Report"
            actions={<button className="button secondary" type="button" onClick={function () { downloadCsv("inquiry-conversion.csv", data.inquiryConversion); }}>Export CSV</button>}
          >
            <DataTable
              columns={[
                { key: "source", label: "Source" },
                { key: "total_inquiries", label: "Inquiries" },
                { key: "converted_to_patients", label: "Converted" },
                { key: "conversion_rate", label: "Conversion %" },
                { key: "hot_count", label: "Hot" },
                { key: "warm_count", label: "Warm" },
                { key: "cold_count", label: "Cold" }
              ]}
              rows={data.inquiryConversion}
            />
          </ModuleShell>

          <ModuleShell
            title="Attendance & Service Report"
            actions={<button className="button secondary" type="button" onClick={function () { downloadCsv("attendance-service.csv", data.attendanceService); }}>Export CSV</button>}
          >
            <DataTable
              columns={[
                { key: "employee_name", label: "Employee" },
                { key: "patients_served", label: "Patients Served" },
                { key: "worked_days", label: "Worked Days" },
                { key: "absent_days", label: "Absent Days" }
              ]}
              rows={data.attendanceService}
            />
          </ModuleShell>
        </div>
      </AppShell>
    </AuthGuard>
  );
}

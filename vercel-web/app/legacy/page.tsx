"use client";

import { useState } from "react";
import Link from "next/link";

interface LegacyModuleLink {
  href: string;
  label: string;
  note: string;
}

const MODULES: LegacyModuleLink[] = [
  { href: "/dashboard", label: "Dashboard", note: "KPIs and overview" },
  { href: "/patients", label: "Patients", note: "Demographics, photo, docs, status workflow" },
  { href: "/employees", label: "Employees", note: "Full HR profile with skills, EC, salary" },
  { href: "/inquiries", label: "Inquiries", note: "Lead pipeline with convert-to-patient" },
  { href: "/duties", label: "Duty calendar", note: "Schedule, check-in/out, generate billing entry" },
  { href: "/attendance", label: "Attendance", note: "Mark, edit, missing list" },
  { href: "/billings", label: "Billing", note: "Bill, receipts, totals, close/reopen" },
  { href: "/payouts", label: "Payouts", note: "Ensure, adjust, lock, pay" },
  { href: "/doctors", label: "Doctors", note: "Directory" },
  { href: "/vendors", label: "Vendors", note: "Directory" },
  { href: "/reports", label: "Reports", note: "Monthly P&L, payroll, attendance, inquiries" },
  { href: "/settings", label: "Settings", note: "Branding, services, signatures" },
  { href: "/users", label: "Users & roles", note: "Provisioning + permission matrix" },
  { href: "/audits", label: "Audit log", note: "Full mutation history" }
];

export default function LegacyCrmPage() {
  const [showFrame, setShowFrame] = useState(false);

  if (showFrame) {
    return (
      <main
        style={{
          width: "100vw",
          height: "100vh",
          margin: 0,
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <div
          style={{
            padding: "8px 16px",
            background: "#fef3c7",
            borderBottom: "1px solid #fde68a",
            color: "#92400e",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <span>
            <strong>Classic CRM</strong> — kept for service-entry diary, payout charges and
            historical bookkeeping. Most features are now in the modern React app.
          </span>
          <button
            type="button"
            onClick={function () {
              setShowFrame(false);
            }}
            style={{
              padding: "4px 10px",
              border: "1px solid #92400e",
              background: "#fef3c7",
              color: "#92400e",
              cursor: "pointer",
              borderRadius: 4
            }}
          >
            Back
          </button>
        </div>
        <iframe
          src="/legacy-crm.html?v=delete-verify-20260521-5"
          title="Hominal Healthcare CRM (Classic)"
          style={{
            width: "100%",
            height: "100%",
            border: "0",
            display: "block",
            background: "#ffffff"
          }}
        />
      </main>
    );
  }

  return (
    <main style={{ padding: 32, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>The modern CRM is now full-featured</h1>
      <p className="mini-muted" style={{ marginBottom: 24 }}>
        All core workflows have been ported to the new React shell. Pick a module below to
        continue. The Classic CRM iframe is still available for the few legacy-only screens
        (service-entry diary, payout charges, historical bookkeeping).
      </p>

      <div className="page-grid">
        {MODULES.map(function (m) {
          return (
            <Link
              key={m.href}
              href={m.href}
              style={{
                display: "block",
                padding: 16,
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                background: "#fff",
                textDecoration: "none",
                color: "inherit"
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{m.label}</div>
              <div className="mini-muted">{m.note}</div>
            </Link>
          );
        })}
      </div>

      <div style={{ marginTop: 32 }}>
        <button
          type="button"
          onClick={function () {
            setShowFrame(true);
          }}
          className="button secondary"
        >
          Open Classic CRM (iframe)
        </button>
      </div>
    </main>
  );
}

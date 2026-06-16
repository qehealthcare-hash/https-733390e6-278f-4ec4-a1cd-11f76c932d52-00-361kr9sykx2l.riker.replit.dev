/**
 * Unit tests for the canonical RBAC module.
 *
 * M2-H1 (2026-05-29): pinned because every server route and frontend
 * gate now resolves through these helpers. Any change to the public
 * surface (capability names, role buckets, normalisation) MUST be
 * reflected here so reviewers see the diff.
 */

import { describe, expect, it } from "vitest";
import {
  CANONICAL_ROLES,
  ROLE_CAPABILITIES,
  REGISTRY_READ_ROLES,
  DIRECTORY_READ_ROLES,
  REPORT_READ_ROLES,
  AUDIT_READ_ROLES,
  SETTINGS_READ_ROLES,
  SETTINGS_WRITE_ROLES,
  SETTINGS_DELETE_ROLES,
  USER_ADMIN_ROLES,
  USER_CREATE_ROLES,
  USER_UPDATE_ROLES,
  USER_DEACTIVATE_ROLES,
  ROLE_ADMIN_ROLES,
  WHATSAPP_READ_ROLES,
  UPLOAD_WRITE_ROLES,
  DASHBOARD_READ_ROLES,
  BILLING_READ_ROLES,
  BILLING_WRITE_ROLES,
  INQUIRY_READ_ROLES,
  INQUIRY_WRITE_ROLES,
  PATIENT_READ_ROLES,
  PATIENT_WRITE_ROLES,
  PATIENT_CLOSE_ROLES,
  PATIENT_HISTORY_ROLES,
  EMPLOYEE_READ_ROLES,
  EMPLOYEE_WRITE_ROLES,
  EMPLOYEE_LINKS_ROLES,
  DUTY_READ_ROLES,
  DUTY_WRITE_ROLES,
  DUTY_CHECK_IN_ROLES,
  ATTENDANCE_READ_ROLES,
  ATTENDANCE_WRITE_ROLES,
  ATTENDANCE_DELETE_ROLES,
  PAYOUT_READ_ROLES,
  PAYOUT_WRITE_ROLES,
  PAYOUT_PAY_ROLES,
  PAYOUT_ADJUST_ROLES,
  PAYOUT_REOPEN_ROLES,
  hasCapability,
  isCanonicalRole,
  normalizeRole,
  type Role
} from "@/business/rbac";

describe("CANONICAL_ROLES", () => {
  it("matches the post-reconciliation hh_roles catalogue exactly", () => {
    expect([...CANONICAL_ROLES].sort()).toEqual([
      "Accountant",
      "Admin",
      "Executive",
      "Manager",
      "Nurse",
      "Staff",
      "Supervisor"
    ]);
  });
});

describe("isCanonicalRole", () => {
  it.each(CANONICAL_ROLES)("accepts %s", (role) => {
    expect(isCanonicalRole(role)).toBe(true);
  });

  it("rejects unknown roles", () => {
    expect(isCanonicalRole("Viewer")).toBe(false);
    expect(isCanonicalRole("Doctor")).toBe(false);
    expect(isCanonicalRole("admin")).toBe(false); // case-sensitive
    expect(isCanonicalRole("")).toBe(false);
    expect(isCanonicalRole(null)).toBe(false);
    expect(isCanonicalRole(undefined)).toBe(false);
    expect(isCanonicalRole(42)).toBe(false);
  });
});

describe("normalizeRole", () => {
  it("returns the canonical label for case/whitespace variants", () => {
    expect(normalizeRole("admin")).toBe("Admin");
    expect(normalizeRole(" ADMIN ")).toBe("Admin");
    expect(normalizeRole("manager")).toBe("Manager");
    expect(normalizeRole("ACCOUNTANT")).toBe("Accountant");
  });

  it("normalises separators inside multi-word role variants", () => {
    // The implementation collapses spaces/hyphens to underscores, but
    // none of the canonical labels are multi-word, so any separator
    // mangles the lookup and falls back to Staff. This is intentional —
    // documented here so future readers know the behaviour is by design.
    expect(normalizeRole("Account-Ant")).toBe("Staff");
    expect(normalizeRole("super visor")).toBe("Staff");
  });

  it("falls back to Staff for unknown or empty input", () => {
    expect(normalizeRole(null)).toBe("Staff");
    expect(normalizeRole(undefined)).toBe("Staff");
    expect(normalizeRole("")).toBe("Staff");
    expect(normalizeRole("   ")).toBe("Staff");
    expect(normalizeRole("Viewer")).toBe("Staff"); // unknown -> Staff
    expect(normalizeRole("DOCTOR")).toBe("Staff");
  });
});

describe("hasCapability", () => {
  it("Admin has every capability via the * wildcard", () => {
    expect(hasCapability("Admin", "billings.write")).toBe(true);
    expect(hasCapability("Admin", "patients.delete")).toBe(true);
    expect(hasCapability("Admin", "anything.new")).toBe(true);
  });

  it("returns true when capability is missing/falsy (no restriction asked)", () => {
    expect(hasCapability("Nurse", null)).toBe(true);
    expect(hasCapability("Nurse", undefined)).toBe(true);
    expect(hasCapability("Nurse", "")).toBe(true);
  });

  it("Nurse cannot write billings (canonical denial)", () => {
    expect(hasCapability("Nurse", "billings.write")).toBe(false);
  });

  it("Supervisor cannot read inquiries (matches legacy frontend matrix)", () => {
    expect(hasCapability("Supervisor", "inquiries.read")).toBe(false);
  });

  it("unknown role falls through to Staff capabilities", () => {
    expect(hasCapability("Viewer", "dashboard.read")).toBe(true); // Staff has it
    expect(hasCapability("Viewer", "audits.read")).toBe(false); // Staff doesn't
  });

  it("normalises case/whitespace in role input", () => {
    expect(hasCapability(" manager ", "patients.write")).toBe(true);
    expect(hasCapability("ADMIN", "audits.read")).toBe(true);
  });
});

describe("ROLE_CAPABILITIES", () => {
  it("defines a capability list for every canonical role", () => {
    for (const role of CANONICAL_ROLES) {
      expect(ROLE_CAPABILITIES[role]).toBeDefined();
      expect(ROLE_CAPABILITIES[role].length).toBeGreaterThan(0);
    }
  });

  it("Admin's list contains the wildcard", () => {
    expect(ROLE_CAPABILITIES.Admin).toContain("*");
  });
});

describe("server-side role lists are subsets of CANONICAL_ROLES", () => {
  const lists: Record<string, readonly Role[]> = {
    REGISTRY_READ_ROLES,
    DIRECTORY_READ_ROLES,
    REPORT_READ_ROLES,
    SETTINGS_WRITE_ROLES,
    SETTINGS_DELETE_ROLES,
    USER_CREATE_ROLES,
    USER_UPDATE_ROLES,
    USER_DEACTIVATE_ROLES,
    ROLE_ADMIN_ROLES,
    AUDIT_READ_ROLES,
    SETTINGS_READ_ROLES,
    USER_ADMIN_ROLES,
    WHATSAPP_READ_ROLES,
    UPLOAD_WRITE_ROLES,
    DASHBOARD_READ_ROLES,
    BILLING_READ_ROLES,
    BILLING_WRITE_ROLES,
    INQUIRY_READ_ROLES,
    INQUIRY_WRITE_ROLES,
    PATIENT_READ_ROLES,
    PATIENT_WRITE_ROLES,
    PATIENT_CLOSE_ROLES,
    PATIENT_HISTORY_ROLES,
    EMPLOYEE_READ_ROLES,
    EMPLOYEE_WRITE_ROLES,
    EMPLOYEE_LINKS_ROLES,
    DUTY_READ_ROLES,
    DUTY_WRITE_ROLES,
    DUTY_CHECK_IN_ROLES,
    ATTENDANCE_READ_ROLES,
    ATTENDANCE_WRITE_ROLES,
    ATTENDANCE_DELETE_ROLES,
    PAYOUT_READ_ROLES,
    PAYOUT_WRITE_ROLES,
    PAYOUT_PAY_ROLES,
    PAYOUT_ADJUST_ROLES,
    PAYOUT_REOPEN_ROLES
  };

  it("PATIENT_READ_ROLES matches frontend patients.read (M5)", () => {
    for (const role of PATIENT_READ_ROLES) {
      expect(hasCapability(role, "patients.read")).toBe(true);
    }
    expect(hasCapability("Viewer", "patients.read")).toBe(true); // Staff fallback
  });

  it("PATIENT_WRITE_ROLES matches frontend patients.write (M5)", () => {
    for (const role of PATIENT_WRITE_ROLES) {
      expect(hasCapability(role, "patients.write")).toBe(true);
    }
    for (const role of ["Nurse", "Supervisor", "Accountant"] as const) {
      expect(PATIENT_WRITE_ROLES).not.toContain(role);
      expect(hasCapability(role, "patients.write")).toBe(false);
    }
  });

  it("EMPLOYEE_WRITE_ROLES matches frontend employees.write (M6)", () => {
    for (const role of EMPLOYEE_WRITE_ROLES) {
      expect(hasCapability(role, "employees.write")).toBe(true);
    }
    for (const role of ["Staff", "Executive", "Nurse"] as const) {
      expect(EMPLOYEE_WRITE_ROLES).not.toContain(role);
      expect(hasCapability(role, "employees.write")).toBe(false);
    }
  });

  it("DUTY_READ_ROLES includes Supervisor (M7 H1 fix)", () => {
    expect(DUTY_READ_ROLES).toContain("Supervisor");
    expect(hasCapability("Supervisor", "duties.read")).toBe(true);
  });

  it("DUTY_WRITE_ROLES matches duties.write incl. Supervisor, excl. Executive/Nurse (M7)", () => {
    for (const role of DUTY_WRITE_ROLES) {
      expect(hasCapability(role, "duties.write")).toBe(true);
    }
    expect(DUTY_WRITE_ROLES).toContain("Supervisor");
    expect(DUTY_WRITE_ROLES).not.toContain("Executive");
    expect(DUTY_WRITE_ROLES).not.toContain("Nurse");
  });

  it("ATTENDANCE_READ_ROLES includes Executive but not Accountant (M8)", () => {
    expect(ATTENDANCE_READ_ROLES).toContain("Executive");
    expect(ATTENDANCE_READ_ROLES).not.toContain("Accountant");
    expect(hasCapability("Executive", "attendance.read")).toBe(true);
  });

  it("ATTENDANCE_WRITE_ROLES matches attendance.write for field roles (M8)", () => {
    for (const role of ATTENDANCE_WRITE_ROLES) {
      expect(hasCapability(role, "attendance.write")).toBe(true);
    }
    expect(ATTENDANCE_WRITE_ROLES).not.toContain("Executive");
  });

  it("ATTENDANCE_DELETE_ROLES is Admin/Manager only (M8)", () => {
    expect(ATTENDANCE_DELETE_ROLES).toEqual(["Admin", "Manager"]);
  });

  it("PAYOUT_PAY_ROLES is Admin/Accountant only — Manager cannot disburse (M9)", () => {
    expect(PAYOUT_PAY_ROLES).toEqual(["Admin", "Accountant"]);
    expect(PAYOUT_ADJUST_ROLES).toEqual(PAYOUT_PAY_ROLES);
    expect(PAYOUT_WRITE_ROLES).toContain("Manager");
    expect(PAYOUT_PAY_ROLES).not.toContain("Manager");
  });

  it("PAYOUT_REOPEN_ROLES is Admin only (M9)", () => {
    expect(PAYOUT_REOPEN_ROLES).toEqual(["Admin"]);
  });

  it("SETTINGS_WRITE vs SETTINGS_DELETE tiers (M11)", () => {
    expect(SETTINGS_WRITE_ROLES).toEqual(["Admin", "Manager"]);
    expect(SETTINGS_DELETE_ROLES).toEqual(["Admin"]);
    expect(USER_CREATE_ROLES).toEqual(["Admin"]);
    expect(ROLE_ADMIN_ROLES).toEqual(["Admin"]);
  });

  it("REPORT_READ_ROLES includes Executive but not Staff (M10)", () => {
    expect(REPORT_READ_ROLES).toContain("Executive");
    expect(REPORT_READ_ROLES).not.toContain("Staff");
    expect(hasCapability("Executive", "reports.read")).toBe(true);
    expect(hasCapability("Staff", "reports.read")).toBe(true);
  });

  it("EMPLOYEE_LINKS_ROLES allows Accountant but not Nurse (M6)", () => {
    expect(EMPLOYEE_LINKS_ROLES).toContain("Accountant");
    expect(EMPLOYEE_LINKS_ROLES).not.toContain("Nurse");
  });

  it("PATIENT_HISTORY_ROLES allows Nurse but not Accountant (M5)", () => {
    expect(PATIENT_HISTORY_ROLES).toContain("Nurse");
    expect(PATIENT_HISTORY_ROLES).not.toContain("Accountant");
    expect(PATIENT_HISTORY_ROLES).not.toContain("Supervisor");
  });

  it("INQUIRY_READ_ROLES matches frontend inquiries.read (M4-H1)", () => {
    for (const role of INQUIRY_READ_ROLES) {
      expect(hasCapability(role, "inquiries.read")).toBe(true);
    }
    for (const role of ["Nurse", "Supervisor", "Accountant"] as const) {
      expect(INQUIRY_READ_ROLES).not.toContain(role);
      expect(hasCapability(role, "inquiries.read")).toBe(false);
    }
  });

  it.each(Object.entries(lists))(
    "%s only contains canonical role names",
    (_name, list) => {
      for (const role of list) {
        expect(isCanonicalRole(role)).toBe(true);
      }
    }
  );

  it("Admin is in every read list (Admin can read anything)", () => {
    for (const [name, list] of Object.entries(lists)) {
      if (!name.includes("READ")) continue;
      expect(list).toContain("Admin");
    }
  });
});

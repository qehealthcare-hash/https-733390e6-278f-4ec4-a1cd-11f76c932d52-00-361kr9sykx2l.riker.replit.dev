/**
 * Integration test: POST /api/v1/uploads/signed-url
 *
 * Verifies:
 * - auth gate
 * - bucket whitelist
 * - response shape includes path/token/signedUrl
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

import {
  ACTORS,
  ctx,
  expectErrorEnvelope,
  expectOkEnvelope,
  makeRequest,
  setActor
} from "@/test/routeHarness";

import { POST as SignedUrlPost } from "../../../app/api/v1/uploads/signed-url/route";

function signedUploadBody(overrides: Record<string, string> = {}) {
  return {
    bucket: "patient-documents",
    fileName: "scan.pdf",
    mime: "application/pdf",
    resource: "Patients",
    resourceId: "PID000900",
    ...overrides
  };
}

describe("POST /api/v1/uploads/signed-url", () => {
  beforeEach(() => {
    setActor(null);
  });

  it("requires auth", async () => {
    const req = makeRequest("POST", "/api/v1/uploads/signed-url", {
      noAuth: true,
      body: { bucket: "patient-documents", fileName: "x.pdf" }
    });
    const res = await SignedUrlPost(req, ctx({}));
    await expectErrorEnvelope(res, 401, "unauthorized");
  });

  it("rejects buckets outside the whitelist", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/uploads/signed-url", {
      body: signedUploadBody({ bucket: "evil-bucket", fileName: "x.pdf" })
    });
    const res = await SignedUrlPost(req, ctx({}));
    await expectErrorEnvelope(res, 400, "bad_request");
  });

  it("rejects body missing required fields with validation error", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/uploads/signed-url", { body: {} });
    const res = await SignedUrlPost(req, ctx({}));
    // After the Phase 7 storageService rewrite this is now reported through the
    // canonical Zod path, which maps to the 422 validation_error envelope.
    await expectErrorEnvelope(res, 422, "validation_error");
  });

  it("returns path/token/signedUrl for patient-documents", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/uploads/signed-url", {
      body: signedUploadBody()
    });
    const res = await SignedUrlPost(req, ctx({}));
    const data = await expectOkEnvelope<{
      bucket: string;
      path: string;
      token: string;
      signedUrl: string;
    }>(res);
    expect(data.bucket).toBe("patient-documents");
    expect(data.path).toContain("scan.pdf");
    expect(data.token).toBe("signed-upload-token");
    expect(data.signedUrl).toContain("scan.pdf");
  });

  it("sanitizes the filename (strips path separators)", async () => {
    setActor(ACTORS.staff);
    const req = makeRequest("POST", "/api/v1/uploads/signed-url", {
      body: signedUploadBody({
        bucket: "employee-documents",
        resource: "Employees",
        resourceId: "EMP000900",
        fileName: "../../etc/passwd"
      })
    });
    const res = await SignedUrlPost(req, ctx({}));
    const data = await expectOkEnvelope<{ path: string }>(res);
    // The only structural separator must be the date prefix "/" — the filename
    // portion must not contain any further "/" or "\" path separators.
    // Path shape: `Employees/<id>/<date>/<sanitized-filename>` (P1-36).
    const parts = data.path.split("/");
    expect(parts[0]).toBe("Employees");
    expect(parts[1]).toBe("EMP000900");
    expect(parts[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const filenamePortion = parts[3];
    expect(parts.length).toBe(4);
    expect(filenamePortion).not.toMatch(/[/\\]/);
    // Slashes collapsed to underscores; no extra path segments beyond the four-part layout.
    expect(filenamePortion).toMatch(/_/);
  });
});

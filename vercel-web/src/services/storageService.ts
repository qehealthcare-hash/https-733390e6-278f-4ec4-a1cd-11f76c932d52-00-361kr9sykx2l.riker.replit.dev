/**
 * Storage service — signed-upload and signed-download URL minting.
 *
 * Encapsulates the bucket allow-list, path sanitization, and the
 * cross-table "is this path linked to a real CRM record" RPC check so
 * the upload routes can stay thin.
 */

import { z } from "zod";
import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import type { ServiceContext } from "@/types/serviceActor";
import {
  failure,
  passFailure,
  success,
  validationFailure
} from "@/utils/apiResponse";
import {
  storageRepository,
  type SignedDownloadUrl,
  type SignedUploadUrl
} from "@/database/storageRepository";
import { hasBlockedUploadExtension } from "@/lib/api/security";
import { crmTodayIso } from "@/utils/crmToday";

const ALLOWED_BUCKETS = new Set([
  "patient-documents",
  "employee-documents",
  "payout-proofs"
]);

/** Roles allowed to mint signed upload URLs (patient/employee docs). */
const UPLOAD_ROLES = new Set([
  "Admin",
  "Manager",
  "Accountant",
  "Staff",
  "Executive",
  "Nurse"
]);

/** Per-bucket download allow-list — Nurses must not fetch payout-proofs (P1-43). */
const BUCKET_READ_ROLES: Record<string, Set<string>> = {
  "patient-documents": UPLOAD_ROLES,
  "employee-documents": UPLOAD_ROLES,
  "payout-proofs": new Set(["Admin", "Manager", "Accountant"])
};

function getBucketReadRoles(bucket: string): Set<string> | undefined {
  return BUCKET_READ_ROLES[bucket];
}

// P1-35: explicit MIME allow-list. Before this, callers could attach any
// Content-Type to the signed upload — including text/html or
// application/javascript — and then load the resulting object inline from
// the same origin to launch stored XSS off the storage CDN. The enum
// covers patient/employee documents (PDF, images), payout-proof
// screenshots, and the small Word/Excel forms HR sometimes attaches.
const ALLOWED_UPLOAD_MIMES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
] as const;

const uploadSchema = z.object({
  bucket: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  mime: z.enum(ALLOWED_UPLOAD_MIMES, {
    errorMap: () => ({
      message: `mime must be one of: ${ALLOWED_UPLOAD_MIMES.join(", ")}`
    })
  }),
  // P1-36: every upload now MUST declare the resource it belongs to, so the
  // object key carries `Patients/<id>/...`, `Employees/<id>/...`, or
  // `Invoices/<id>/...`. Without this, anyone with upload role could PUT
  // into any path inside the bucket — a phished Nurse could overwrite an
  // Admin's signed PDF. The id pattern matches our canonical CRM ids.
  resource: z.enum(["Patients", "Employees", "Invoices"] as const, {
    errorMap: () => ({
      message: "resource must be one of: Patients, Employees, Invoices"
    })
  }),
  resourceId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "resourceId must be 1-64 of [A-Za-z0-9_-]")
});

const downloadSchema = z.object({
  bucket: z.string().trim().min(1),
  path: z.string().trim().min(1).max(512),
  // Max TTL lowered from 60 min → 30 min to keep PHI/PDF blob URLs short-lived.
  // Default lowered from 10 min → 5 min so a click in the UI mints a URL that
  // expires soon after the operator has reasonably looked at the document.
  expires_in: z.coerce.number().int().min(30).max(1800).optional().default(300),
  download_as: z.string().trim().max(255).optional()
});

/** Strip path separators and weird characters, keep a useful extension. */
function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/]/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(-120);
  return cleaned || "file";
}

function buildObjectPath(
  resource: "Patients" | "Employees" | "Invoices",
  resourceId: string,
  fileName: string
): string {
  const today = crmTodayIso();
  const uniq = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  // P1-36: <Resource>/<id>/<YYYY-MM-DD>/<uniq>-<safeName>. The prefix lets
  // future bucket policies grant read on `Patients/<thisPatient>/*` only.
  return `${resource}/${resourceId}/${today}/${uniq}-${sanitizeFileName(fileName)}`;
}

function isSafeObjectPath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  const segments = path.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return false;
  }
  return true;
}

export const storageService = {
  async createSignedUpload(
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<SignedUploadUrl>> {
    const role = ctx.actor.role || "";
    if (!UPLOAD_ROLES.has(role)) {
      return failure("Role not allowed to upload documents", ErrorCodes.forbidden);
    }
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const { bucket, fileName, mime, resource, resourceId } = parsed.data;
    if (hasBlockedUploadExtension(fileName)) {
      return failure("File type is not allowed for upload", ErrorCodes.badRequest);
    }
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return failure(`Bucket '${bucket}' is not allowed for uploads`, ErrorCodes.badRequest);
    }
    const path = buildObjectPath(resource, resourceId, fileName);
    // P1-36: belt-and-braces — the regex+enum above already forbids traversal,
    // but isSafeObjectPath catches anything sneaky and the startsWith() guard
    // makes the per-resource prefix invariant explicit in the call site.
    if (!isSafeObjectPath(path)) {
      return failure("Object path is not allowed", ErrorCodes.badRequest);
    }
    if (
      !path.startsWith("Patients/") &&
      !path.startsWith("Employees/") &&
      !path.startsWith("Invoices/")
    ) {
      return failure(
        "Object path must start with a known resource prefix (Patients/, Employees/, Invoices/)",
        ErrorCodes.badRequest
      );
    }
    return storageRepository.createSignedUploadUrl({ bucket, path, mime });
  },

  async createSignedDownload(
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<SignedDownloadUrl>> {
    const role = ctx.actor.role || "";
    const parsed = downloadSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const { bucket, path, expires_in, download_as } = parsed.data;

    const bucketRoles = getBucketReadRoles(bucket);
    if (!bucketRoles || !bucketRoles.has(role)) {
      return failure(
        `Role '${role}' is not allowed to download from bucket '${bucket}'`,
        ErrorCodes.forbidden
      );
    }

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return failure(`Bucket '${bucket}' is not allowed`, ErrorCodes.badRequest);
    }
    if (!isSafeObjectPath(path)) {
      return failure("Object path is not allowed", ErrorCodes.badRequest);
    }

    const linked = await storageRepository.pathInUse(bucket, path);
    if (!linked.success) return passFailure(linked);
    if (!linked.data) {
      return failure(
        "Document path is not linked to any CRM record (patient, employee, or payout proof)",
        ErrorCodes.forbidden
      );
    }

    const signed = await storageRepository.createSignedDownload(
      bucket,
      path,
      expires_in,
      download_as
    );
    if (!signed.success) return passFailure(signed);
    if (!signed.data) return failure("Storage returned no data", ErrorCodes.upstream);
    return success(signed.data);
  }
};

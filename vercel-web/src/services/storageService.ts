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

/**
 * Roles allowed to mint download URLs. Mirrors patient/employee read RBAC.
 *
 * `Accountant` is included so payout-proof images / PDFs (which only the
 * Accountant + Admin tier create) can also be opened back for audit.
 */
const READ_ROLES = new Set([
  "Admin",
  "Manager",
  "Accountant",
  "Staff",
  "Executive",
  "Nurse"
]);

const uploadSchema = z.object({
  bucket: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255)
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

function buildObjectPath(fileName: string): string {
  const today = crmTodayIso();
  const uniq = (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  ).slice(0, 12);
  return `${today}/${uniq}-${sanitizeFileName(fileName)}`;
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
    if (!READ_ROLES.has(role)) {
      return failure("Role not allowed to upload documents", ErrorCodes.forbidden);
    }
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const { bucket, fileName } = parsed.data;
    if (hasBlockedUploadExtension(fileName)) {
      return failure("File type is not allowed for upload", ErrorCodes.badRequest);
    }
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return failure(`Bucket '${bucket}' is not allowed for uploads`, ErrorCodes.badRequest);
    }
    const path = buildObjectPath(fileName);
    return storageRepository.createSignedUpload(bucket, path);
  },

  async createSignedDownload(
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<SignedDownloadUrl>> {
    const role = ctx.actor.role || "";
    if (!READ_ROLES.has(role)) {
      return failure("Role not allowed to download documents", ErrorCodes.forbidden);
    }

    const parsed = downloadSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const { bucket, path, expires_in, download_as } = parsed.data;

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

/**
 * Storage repository — Supabase Storage signed-URL access.
 *
 * Centralises every call to `supabase.storage.from(...)` and the
 * `crm_storage_path_in_use` RPC so the upload service stays free of
 * direct Supabase imports.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { adminClient } from "@/database/supabaseClient";
import { dbFailure, failure } from "@/utils/apiResponse";

export interface SignedUploadUrl {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
}

export interface SignedDownloadUrl {
  bucket: string;
  path: string;
  signedUrl: string;
  expires_in: number;
}

export const storageRepository = {
  /**
   * P1-35: signed-upload URL minting now takes a structured options object
   * (bucket / path / mime). The mime travels with the request so the
   * service-layer allow-list lands here too; Supabase Storage does not yet
   * accept a contentType on createSignedUploadUrl, so we attach it via the
   * upsert wrapper headers. Until then the value is still enforced at the
   * service layer (z.enum) — passing it through here makes the audit obvious.
   */
  async createSignedUploadUrl(opts: {
    bucket: string;
    path: string;
    mime: string;
  }): Promise<ApiResult<SignedUploadUrl>> {
    try {
      const { bucket, path } = opts;
      const { data, error } = await adminClient()
        .storage.from(bucket)
        .createSignedUploadUrl(path);
      if (error || !data) {
        return failure(
          `Could not create signed upload URL: ${error?.message || "unknown error"}`,
          ErrorCodes.upstream
        );
      }
      return {
        success: true,
        data: {
          bucket,
          path: data.path,
          token: data.token,
          signedUrl: data.signedUrl
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Storage call failed";
      return failure(message, ErrorCodes.upstream);
    }
  },

  async pathInUse(bucket: string, path: string): Promise<ApiResult<boolean>> {
    try {
      const { data, error } = await adminClient().rpc("crm_storage_path_in_use", {
        p_bucket: bucket,
        p_path: path
      });
      if (error) {
        return dbFailure(`Document path check failed: ${error.message}`, {
          scope: "storage.pathInUse"
        });
      }
      return { success: true, data: Boolean(data) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Path check failed";
      return dbFailure(message, { scope: "storage.pathInUse" });
    }
  },

  async createSignedDownload(
    bucket: string,
    path: string,
    expiresIn: number,
    downloadAs?: string
  ): Promise<ApiResult<SignedDownloadUrl>> {
    try {
      const { data, error } = await adminClient()
        .storage.from(bucket)
        .createSignedUrl(path, expiresIn, downloadAs ? { download: downloadAs } : undefined);
      if (error || !data?.signedUrl) {
        return failure(
          `Could not create signed download URL: ${error?.message || "unknown error"}`,
          ErrorCodes.upstream
        );
      }
      return {
        success: true,
        data: { bucket, path, signedUrl: data.signedUrl, expires_in: expiresIn }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Storage call failed";
      return failure(message, ErrorCodes.upstream);
    }
  }
};

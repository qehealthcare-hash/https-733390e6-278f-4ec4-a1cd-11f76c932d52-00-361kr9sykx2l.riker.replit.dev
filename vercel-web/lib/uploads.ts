import { requestValidated, type ApiSession } from "./api-client";
import {
  signedDownloadUrlDtoSchema,
  signedUploadUrlDtoSchema
} from "@/validation/storageDto";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf"
]);

export type StoredDocument = {
  bucket?: string;
  path?: string;
  file_name?: string;
  mime_type?: string;
  size?: number;
  uploaded_at?: string;
};

type SignedDownloadResponse = {
  signedUrl: string;
  bucket: string;
  path: string;
  expires_in: number;
};

export type UploadSupabaseClient = {
  storage: {
    from: (bucket: string) => {
      uploadToSignedUrl: (
        path: string,
        token: string,
        file: File,
        opts: { contentType: string; upsert: boolean }
      ) => Promise<{ error?: { message?: string } | null }>;
    };
  };
};

export type UploadDocumentOptions = {
  file: File;
  bucket: string;
  session: ApiSession;
  /** Browser Supabase client from `useAuth().supabase` */
  supabase: unknown;
  resource: string;
  resourceId: string;
};

function humaniseBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

export async function uploadDocument(options: UploadDocumentOptions): Promise<StoredDocument> {
  if (!options?.file) {
    throw new Error("No file selected");
  }
  if (!options.bucket) {
    throw new Error("Upload bucket not specified");
  }
  if (!options.session?.access_token) {
    throw new Error("You must be signed in to upload files");
  }
  if (!options.supabase) {
    throw new Error("Supabase client unavailable for upload");
  }

  const file = options.file;
  const mime = file.type || "application/octet-stream";

  if (file.size > MAX_BYTES) {
    throw new Error(
      "File '" +
        file.name +
        "' is " +
        humaniseBytes(file.size) +
        " — limit is " +
        humaniseBytes(MAX_BYTES)
    );
  }
  if (mime !== "application/octet-stream" && !ALLOWED_MIME.has(mime)) {
    throw new Error(
      "File type '" + mime + "' is not allowed. Use JPG, PNG, WebP, HEIC, or PDF."
    );
  }

  const resource = options.resource;
  const resourceId = options.resourceId;
  if (!resource || !resourceId) {
    throw new Error("uploadDocument requires `resource` and `resourceId` (P1-36)");
  }

  let signed: { path: string; token: string };
  try {
    signed = await requestValidated(
      "/uploads/signed-url",
      {
        method: "POST",
        body: {
          bucket: options.bucket,
          fileName: file.name,
          mime,
          resource,
          resourceId
        }
      },
      options.session,
      signedUploadUrlDtoSchema
    );
  } catch (err: unknown) {
    const serverMessage = err instanceof Error ? err.message : "could not get upload URL";
    throw new Error("Upload could not start: " + serverMessage);
  }

  if (!signed?.path || !signed?.token) {
    throw new Error("Upload service returned an invalid signed URL");
  }

  const supabase = options.supabase as UploadSupabaseClient;

  let uploadResult: { error?: { message?: string } | null };
  try {
    uploadResult = await supabase.storage
      .from(options.bucket)
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: mime,
        upsert: true
      });
  } catch (err: unknown) {
    throw new Error("Upload failed: " + (err instanceof Error ? err.message : "network error"));
  }

  if (uploadResult?.error) {
    throw new Error("Upload failed: " + (uploadResult.error.message || "unknown error"));
  }

  return {
    bucket: options.bucket,
    path: signed.path,
    file_name: file.name,
    mime_type: mime,
    size: file.size,
    uploaded_at: new Date().toISOString()
  };
}

export async function getDocumentSignedUrl(
  doc: StoredDocument | Record<string, unknown> | null | undefined,
  session: ApiSession,
  opts?: { expiresIn?: number; download?: boolean }
): Promise<SignedDownloadResponse | null> {
  const bucket = doc?.bucket != null ? String(doc.bucket) : "";
  const path = doc?.path != null ? String(doc.path) : "";
  if (!bucket || !path) return null;
  if (!session?.access_token) {
    throw new Error("Sign in to view this document");
  }
  const body: Record<string, unknown> = {
    bucket,
    path,
    expires_in: opts?.expiresIn || 600
  };
  const fileName = doc && "file_name" in doc ? doc.file_name : undefined;
  if (opts?.download && fileName) {
    body.download_as = String(fileName);
  }
  const data = await requestValidated(
    "/uploads/signed-download",
    { method: "POST", body },
    session,
    signedDownloadUrlDtoSchema
  );
  return data.signedUrl ? data : null;
}

export function isImageDocument(
  doc: StoredDocument | Record<string, unknown> | null | undefined
): boolean {
  if (!doc) return false;
  const mime = String(doc.mime_type || "").toLowerCase();
  if (mime.indexOf("image/") === 0) return true;
  const name = String(doc.file_name || doc.path || "").toLowerCase();
  return /\.(jpe?g|png|webp|heic|heif|gif)$/.test(name);
}

export function isPdfDocument(
  doc: StoredDocument | Record<string, unknown> | null | undefined
): boolean {
  if (!doc) return false;
  if (String(doc.mime_type || "").toLowerCase() === "application/pdf") return true;
  const name = String(doc.file_name || doc.path || "").toLowerCase();
  return /\.pdf$/.test(name);
}

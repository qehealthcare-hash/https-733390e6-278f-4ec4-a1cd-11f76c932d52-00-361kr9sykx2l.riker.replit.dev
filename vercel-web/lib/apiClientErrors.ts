/** Shared helpers for CRM API client errors thrown by `lib/api-client.ts`. */

import { CONTRACT_ERROR_CODE } from "@/lib/api-client";

export function isApiContractError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === CONTRACT_ERROR_CODE;
}

export function isApiConflictError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === "conflict";
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

/**
 * In-memory OTP store for phone login (v1).
 * Replace with Upstash Redis in milestone 13 for production scale.
 */

import { createHash } from "node:crypto";

type Entry = {
  hash: string;
  expiresAt: number;
  attempts: number;
};

const store = new Map<string, Entry>();

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashOtp(otp: string, phone: string): string {
  const salt = process.env.OTP_STORE_SALT ?? "maths-mania-otp";
  return createHash("sha256").update(`${salt}:${phone}:${otp}`).digest("hex");
}

export function saveOtp(phone: string, otp: string): void {
  store.set(phone, {
    hash: hashOtp(otp, phone),
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
  });
}

export function verifyOtp(phone: string, otp: string): boolean {
  const entry = store.get(phone);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(phone);
    return false;
  }
  entry.attempts += 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    store.delete(phone);
    return false;
  }
  const valid = entry.hash === hashOtp(otp, phone);
  if (valid) store.delete(phone);
  return valid;
}

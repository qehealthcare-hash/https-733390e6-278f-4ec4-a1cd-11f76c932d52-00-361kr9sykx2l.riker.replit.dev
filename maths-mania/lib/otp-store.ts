/**
 * OTP store — Upstash Redis in production, in-memory fallback for local dev.
 */

import { createHash } from "node:crypto";
import { getRedis } from "@/lib/upstash";

type Entry = {
  hash: string;
  expiresAt: number;
  attempts: number;
};

const store = new Map<string, Entry>();

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const REDIS_TTL_SEC = 600;

function hashOtp(otp: string, phone: string): string {
  const salt = process.env.OTP_STORE_SALT ?? "maths-mania-otp";
  return createHash("sha256").update(`${salt}:${phone}:${otp}`).digest("hex");
}

function redisKey(phone: string): string {
  return `otp:${phone}`;
}

export async function saveOtp(phone: string, otp: string): Promise<void> {
  const hash = hashOtp(otp, phone);
  const redis = getRedis();

  if (redis) {
    await redis.set(
      redisKey(phone),
      JSON.stringify({ hash, attempts: 0 }),
      { ex: REDIS_TTL_SEC },
    );
    return;
  }

  store.set(phone, {
    hash,
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
  });
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const redis = getRedis();

  if (redis) {
    const raw = await redis.get<string>(redisKey(phone));
    if (!raw) return false;

    let parsed: { hash: string; attempts: number };
    try {
      parsed =
        typeof raw === "string"
          ? (JSON.parse(raw) as { hash: string; attempts: number })
          : (raw as { hash: string; attempts: number });
    } catch {
      await redis.del(redisKey(phone));
      return false;
    }

    parsed.attempts += 1;
    if (parsed.attempts > MAX_ATTEMPTS) {
      await redis.del(redisKey(phone));
      return false;
    }

    const valid = parsed.hash === hashOtp(otp, phone);
    if (valid) {
      await redis.del(redisKey(phone));
    } else {
      await redis.set(redisKey(phone), JSON.stringify(parsed), {
        ex: REDIS_TTL_SEC,
      });
    }
    return valid;
  }

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

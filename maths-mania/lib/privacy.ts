import { createHash } from "node:crypto";

/** One-way hash for storing IPs in marketing tables (not reversible). */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "maths-mania-v1";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

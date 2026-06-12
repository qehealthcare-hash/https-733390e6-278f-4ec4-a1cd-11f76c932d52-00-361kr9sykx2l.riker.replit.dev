import { randomInt } from "node:crypto";

/** Uniform random decimal digits for human-readable CRM ids (replaces Math.random). */
export function randomDigits(len: number): string {
  if (len < 1) return "";
  const max = 10 ** len;
  return String(randomInt(0, max)).padStart(len, "0");
}

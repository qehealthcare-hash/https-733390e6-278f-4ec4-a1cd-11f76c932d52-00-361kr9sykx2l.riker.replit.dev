/** Compact id generators that match the legacy CRM format. */

import { randomDigits } from "@/utils/secureRandom";

function pad(n: number, len: number): string {
  return n.toString().padStart(len, "0");
}

function timestampKey(): string {
  const d = new Date();
  return (
    d.getUTCFullYear().toString().slice(-2) +
    pad(d.getUTCMonth() + 1, 2) +
    pad(d.getUTCDate(), 2) +
    pad(d.getUTCHours(), 2) +
    pad(d.getUTCMinutes(), 2) +
    pad(d.getUTCSeconds(), 2)
  );
}

function rand(len: number): string {
  return randomDigits(len);
}

export const newId = {
  inquiry: () => `INQ${Date.now().toString().slice(-7)}`,
  patient: () => `P${timestampKey().slice(2, 8)}${rand(4)}`,
  duty: () => `D${timestampKey()}${rand(3)}`,
  attendance: () => `AT${timestampKey()}${rand(3)}`,
  billing: () => `B${timestampKey().slice(2, 8)}${rand(4)}`,
  receipt: () => `RC${timestampKey()}${rand(2)}`,
  payout: () => `PO${timestampKey().slice(2, 8)}${rand(5)}`,
  whatsapp: () => `WA${timestampKey()}${rand(3)}`,
  ai: () => `AI${timestampKey()}${rand(3)}`,
  aiConv: () => `AIC${timestampKey()}${rand(3)}`,
  employee: () => `E${timestampKey().slice(2, 8)}${rand(4)}`
};

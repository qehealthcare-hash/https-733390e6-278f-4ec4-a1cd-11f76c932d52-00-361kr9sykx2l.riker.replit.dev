/**
 * Redact common PHI fields before CRM context is sent to an external LLM.
 */

const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/gi;
const MOBILE_RE = /\b[6-9]\d{9}\b/g;

function redactString(value: string): string {
  return value.replace(EMAIL_RE, "[email]").replace(MOBILE_RE, "[mobile]");
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        lower === "email" ||
        lower.includes("mobile") ||
        lower.includes("phone") ||
        lower === "contact"
      ) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactValue(child);
      }
    }
    return out;
  }
  return value;
}

export function sanitizeForLlm<T>(payload: T): T {
  return redactValue(payload) as T;
}

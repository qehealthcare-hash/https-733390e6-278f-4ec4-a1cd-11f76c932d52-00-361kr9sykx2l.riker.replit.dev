import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/api/env";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { whatsappWebhookResultDtoSchema } from "@/validation/whatsappDto";
import { enforceRateLimit, timingSafeEqualString } from "@/lib/api/security";
import { whatsappService } from "@/services/whatsappService";
import { whatsappWebhookPayloadSchema } from "@/validation/whatsappValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta webhook verification handshake (hub.mode=subscribe).
 *
 * This endpoint MUST echo the raw `hub.challenge` text to satisfy Meta's
 * protocol contract — it cannot use the canonical JSON envelope here.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (
    mode === "subscribe" &&
    token &&
    env.whatsappVerifyToken &&
    timingSafeEqualString(token, env.whatsappVerifyToken)
  ) {
    return new NextResponse(challenge || "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Verify Meta's X-Hub-Signature-256 header. Constant-time compare. */
function verifySignature(rawBody: string, headerSignature: string | null): boolean {
  if (!env.whatsappAppSecret) return false;
  if (!headerSignature) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", env.whatsappAppSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(headerSignature);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Meta sends raw HTTP responses for non-2xx, so the few short-circuit
 * responses below also stay as plain text to match the protocol contract.
 * Successful processing uses the canonical envelope via `respondValidated()`.
 */
export async function POST(req: NextRequest) {
  if (!env.whatsappAppSecret) {
    return new NextResponse("webhook not configured", { status: 503 });
  }
  try {
    enforceRateLimit(req, "whatsapp-webhook", 120, 60_000);
  } catch {
    return new NextResponse("too many requests", { status: 429 });
  }
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const verified = verifySignature(raw, signature);
  if (!verified) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      return new NextResponse("invalid body", { status: 400 });
    }
  }
  // P1-24: Meta sometimes sends partial / malformed payloads (especially
  // during webhook re-subscribes), and an attacker who replays a captured
  // HMAC could craft a body that crashes recordWebhook by missing fields.
  // Validate against the Zod envelope before letting the service touch it.
  // The schema is passthrough on inner fields so future Meta additions still
  // flow through — we just enforce the top-level entry/changes shape.
  const parsed = whatsappWebhookPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return new NextResponse("invalid payload shape", { status: 400 });
  }
  const result = await whatsappService.recordWebhook(parsed.data, { verified });
  return respondValidated(result, whatsappWebhookResultDtoSchema);
}

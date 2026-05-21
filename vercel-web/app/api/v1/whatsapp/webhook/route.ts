import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { jsonError, jsonOk } from "@/lib/api/errors";
import { env } from "@/lib/api/env";
import { whatsappService } from "@/lib/api/services/whatsapp.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Meta webhook verification handshake (hub.mode=subscribe). */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && env.whatsappVerifyToken && token === env.whatsappVerifyToken) {
    return new NextResponse(challenge || "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Verify Meta's X-Hub-Signature-256 header. Constant-time compare. */
function verifySignature(rawBody: string, headerSignature: string | null): boolean {
  if (!env.whatsappAppSecret) return false;
  if (!headerSignature) return false;
  const expected = "sha256=" + createHmac("sha256", env.whatsappAppSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(headerSignature);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    const verified = verifySignature(raw, signature);
    if (!verified && env.whatsappAppSecret) {
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
    const result = await whatsappService.recordWebhook(payload, { verified });
    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}

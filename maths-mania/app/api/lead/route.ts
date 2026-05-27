import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s-]{10,15}$/;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(`lead:${ip}`, 5, 60_000);
  if (!rl.ok) {
    return Response.json(
      {
        ok: false,
        message: `Too many requests. Try again in ${rl.retryAfterSec}s.`,
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json({ ok: false, message: "Invalid body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const email =
    typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const whatsapp =
    typeof raw.whatsapp === "string" ? raw.whatsapp.trim() : "";
  const resourceId =
    typeof raw.resourceId === "string" ? raw.resourceId.trim() : "";
  const resourceTitle =
    typeof raw.resourceTitle === "string" ? raw.resourceTitle.trim() : "";

  if (!email || !EMAIL_RE.test(email)) {
    return Response.json(
      { ok: false, message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  if (whatsapp && !PHONE_RE.test(whatsapp)) {
    return Response.json(
      { ok: false, message: "Please enter a valid WhatsApp number (with country code)." },
      { status: 400 },
    );
  }

  const dataDir = path.join(process.cwd(), "data");
  const file = path.join(dataDir, "leads.jsonl");
  const line = JSON.stringify({
    email,
    whatsapp: whatsapp || null,
    resourceId,
    resourceTitle,
    at: new Date().toISOString(),
    ip,
    source: "resource-download",
  });

  try {
    await mkdir(dataDir, { recursive: true });
    await appendFile(file, line + "\n", "utf8");
  } catch (err) {
    console.error("[lead] write failed", err);
    return Response.json(
      { ok: false, message: "Could not save your details. Try again later." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, message: "Lead captured." });
}

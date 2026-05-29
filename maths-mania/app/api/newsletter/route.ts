import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { hashIp } from "@/lib/privacy";
import { getClientIp, rateLimitRequest } from "@/lib/rate-limit";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = await rateLimitRequest(`newsletter:${ip}`, 5, 60_000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, message: `Too many requests. Try again in ${rl.retryAfterSec}s.` },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const email =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof (body as { email: unknown }).email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";

  if (!email || !EMAIL_RE.test(email)) {
    return Response.json(
      { ok: false, message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  if (isSupabaseAdminConfigured()) {
    try {
      const admin = tryCreateAdminClient()!;
      const { error } = await admin.from("newsletter_subscribers").upsert(
        {
          email,
          source: "home-newsletter",
          ip_hash: hashIp(ip),
        },
        { onConflict: "email" },
      );
      if (error) {
        console.error("[newsletter] supabase upsert failed", error);
        return Response.json(
          { ok: false, message: "Could not save subscription. Try again later." },
          { status: 500 },
        );
      }
      return Response.json({ ok: true, message: "Subscribed." });
    } catch (err) {
      console.error("[newsletter] supabase error", err);
      return Response.json(
        { ok: false, message: "Could not save subscription. Try again later." },
        { status: 500 },
      );
    }
  }

  const dataDir = path.join(process.cwd(), "data");
  const file = path.join(dataDir, "newsletter.jsonl");
  const line = JSON.stringify({
    email,
    at: new Date().toISOString(),
    ip,
    source: "home-newsletter",
  });

  try {
    await mkdir(dataDir, { recursive: true });
    await appendFile(file, line + "\n", "utf8");
  } catch (err) {
    console.error("[newsletter] write failed", err);
    return Response.json(
      { ok: false, message: "Could not save subscription. Try again later." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, message: "Subscribed." });
}

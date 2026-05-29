import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { hashIp } from "@/lib/privacy";
import { getClientIp, rateLimitRequest } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOPICS = new Set([
  "general",
  "exam",
  "school",
  "banking",
  "partnership",
]);

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = await rateLimitRequest(`contact:${ip}`, 5, 60_000);
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
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const email =
    typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const topic = typeof raw.topic === "string" ? raw.topic.trim() : "general";
  const message = typeof raw.message === "string" ? raw.message.trim() : "";

  if (!name || name.length < 2) {
    return Response.json(
      { ok: false, message: "Please enter your name." },
      { status: 400 },
    );
  }

  if (!email || !EMAIL_RE.test(email)) {
    return Response.json(
      { ok: false, message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  if (!TOPICS.has(topic)) {
    return Response.json(
      { ok: false, message: "Please choose a valid topic." },
      { status: 400 },
    );
  }

  if (!message || message.length < 10) {
    return Response.json(
      { ok: false, message: "Please write a bit more detail (10+ characters)." },
      { status: 400 },
    );
  }

  if (message.length > 5000) {
    return Response.json(
      { ok: false, message: "Message is too long." },
      { status: 400 },
    );
  }

  const dataDir = path.join(process.cwd(), "data");
  const file = path.join(dataDir, "contact.jsonl");
  const line = JSON.stringify({
    name,
    email,
    topic,
    message,
    at: new Date().toISOString(),
    ip_hash: hashIp(ip),
    source: "contact-form",
  });

  try {
    await mkdir(dataDir, { recursive: true });
    await appendFile(file, line + "\n", "utf8");
  } catch (err) {
    console.error("[contact] write failed", err);
    return Response.json(
      { ok: false, message: "Could not send your message. Try again later." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, message: "Message received." });
}

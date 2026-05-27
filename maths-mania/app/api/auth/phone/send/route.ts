import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  generateOtp,
  isMsg91Configured,
  normalizeIndianPhone,
  sendOtpViaMsg91,
} from "@/lib/msg91";
import { saveOtp } from "@/lib/otp-store";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(`otp-send:${ip}`, 5, 60_000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, message: `Too many attempts. Try again in ${rl.retryAfterSec}s.` },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const phoneRaw =
    typeof body === "object" &&
    body !== null &&
    "phone" in body &&
    typeof (body as { phone: unknown }).phone === "string"
      ? (body as { phone: string }).phone
      : "";

  const mobile = normalizeIndianPhone(phoneRaw);
  if (!mobile) {
    return Response.json(
      { ok: false, message: "Enter a valid 10-digit Indian mobile number." },
      { status: 400 },
    );
  }

  const otp = generateOtp();
  saveOtp(mobile, otp);

  const sent = await sendOtpViaMsg91(mobile, otp);
  if (!sent.ok) {
    return Response.json(
      { ok: false, message: sent.message ?? "Could not send OTP." },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    message: isMsg91Configured()
      ? "OTP sent to your phone."
      : "OTP sent (dev mode — check server logs if SMS is not configured).",
    phone: mobile,
  });
}

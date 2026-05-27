import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/supabase/config";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeIndianPhone, verifyOtpViaMsg91 } from "@/lib/msg91";
import { verifyOtp } from "@/lib/otp-store";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(`otp-verify:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, message: `Too many attempts. Try again in ${rl.retryAfterSec}s.` },
      { status: 429 },
    );
  }

  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return Response.json(
      { ok: false, message: "Sign-in is not configured on this environment." },
      { status: 503 },
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
  const phoneRaw = typeof raw.phone === "string" ? raw.phone : "";
  const otp = typeof raw.otp === "string" ? raw.otp.trim() : "";

  const mobile = normalizeIndianPhone(phoneRaw);
  if (!mobile || otp.length !== 6) {
    return Response.json(
      { ok: false, message: "Enter your phone number and 6-digit OTP." },
      { status: 400 },
    );
  }

  const localOk = verifyOtp(mobile, otp);
  const msg91Ok = localOk ? { ok: true } : await verifyOtpViaMsg91(mobile, otp);

  if (!localOk && !msg91Ok.ok) {
    return Response.json(
      { ok: false, message: "Invalid or expired OTP." },
      { status: 401 },
    );
  }

  const admin = createAdminClient();
  const email = `phone+${mobile}@users.mathsmania.in`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      phone: `+${mobile}`,
      user_metadata: { phone: mobile, auth_provider: "phone" },
    });

  const userId = created.user?.id;
  if (createError && !createError.message.toLowerCase().includes("already")) {
    console.error("[phone/verify] createUser", createError.message);
    return Response.json(
      { ok: false, message: "Could not create account." },
      { status: 500 },
    );
  }

  if (userId) {
    await admin.from("profiles").upsert({
      id: userId,
      full_name: `Student ${mobile.slice(-4)}`,
      phone: `+${mobile}`,
    });
  }

  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${siteUrl}/auth/callback?next=/onboarding`,
      },
    });

  const actionLink = linkData.properties?.action_link;
  if (linkError || !actionLink) {
    console.error("[phone/verify] generateLink", linkError);
    return Response.json(
      { ok: false, message: "Could not start session." },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    message: "Verified. Redirecting…",
    actionLink,
  });
}

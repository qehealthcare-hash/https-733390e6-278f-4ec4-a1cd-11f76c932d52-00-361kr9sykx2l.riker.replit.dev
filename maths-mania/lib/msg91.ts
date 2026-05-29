/**
 * MSG91 OTP helpers (India phone auth).
 * No-op with dev fallback when MSG91_AUTH_KEY is unset.
 */

const MSG91_SEND_URL = "https://control.msg91.com/api/v5/otp";
const MSG91_VERIFY_URL = "https://control.msg91.com/api/v5/otp/verify";

export function isMsg91Configured(): boolean {
  return Boolean(
    process.env.MSG91_AUTH_KEY?.trim() &&
      process.env.MSG91_TEMPLATE_ID?.trim(),
  );
}

/** Normalise to digits with country code (default +91). */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return null;
}

export async function sendOtpViaMsg91(
  mobile: string,
  otp: string,
): Promise<{ ok: boolean; message?: string }> {
  const authkey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authkey || !templateId) {
    if (process.env.NODE_ENV === "development") {
      console.info(`[msg91:dev] OTP for ${mobile}: ${otp}`);
      return { ok: true };
    }
    return { ok: false, message: "Phone OTP is not configured yet." };
  }

  const res = await fetch(MSG91_SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authkey,
    },
    body: JSON.stringify({
      template_id: templateId,
      mobile,
      otp,
      otp_length: 6,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, message: text || "MSG91 send failed" };
  }

  return { ok: true };
}

export async function verifyOtpViaMsg91(
  mobile: string,
  otp: string,
): Promise<{ ok: boolean; message?: string }> {
  const authkey = process.env.MSG91_AUTH_KEY;

  if (!authkey) {
    if (process.env.NODE_ENV === "development" && otp === "000000") {
      return { ok: true };
    }
    return { ok: false, message: "Phone OTP is not configured yet." };
  }

  const url = new URL(MSG91_VERIFY_URL);
  url.searchParams.set("otp", otp);
  url.searchParams.set("mobile", mobile);

  const res = await fetch(url.toString(), {
    headers: { authkey },
  });

  if (!res.ok) {
    return { ok: false, message: "Invalid or expired OTP." };
  }

  return { ok: true };
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

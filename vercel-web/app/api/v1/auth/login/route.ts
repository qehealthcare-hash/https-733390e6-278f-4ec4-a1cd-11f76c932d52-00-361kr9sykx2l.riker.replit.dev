import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/handler";
import { enforceRateLimitPersistent } from "@/lib/api/security";
import { badRequest, jsonError } from "@/lib/api/errors";
import { respond, respondValidated } from "@/lib/api/apiResultBridge";
import { loginSessionDtoSchema } from "@/validation/authDto";
import { attachRefreshCookie } from "@/lib/auth/refreshCookie";
import { authService } from "@/services/authService";
import { success } from "@/utils/apiResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "identifier is required")
    .max(254, "identifier is too long"),
  password: z.string().min(1, "password is required").max(256, "password is too long")
});

export async function POST(req: NextRequest) {
  try {
    await enforceRateLimitPersistent(req, "login-v2", 20, 60_000);

    const body = await parseJsonBody(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || "Invalid credentials payload");
    }
    const { identifier, password } = parsed.data;

    const result = await authService.login(identifier, password);
    if (!result.success || !result.data) {
      return respond(result);
    }

    const tokenBody = result.data;
    const response = respondValidated(
      success({
        access_token: tokenBody.access_token,
        expires_in: tokenBody.expires_in,
        expires_at: tokenBody.expires_at,
        user: tokenBody.user
      }),
      loginSessionDtoSchema
    );
    if (tokenBody.refresh_token) {
      return attachRefreshCookie(response, tokenBody.refresh_token, tokenBody.expires_in);
    }
    return response;
  } catch (err) {
    return jsonError(err);
  }
}

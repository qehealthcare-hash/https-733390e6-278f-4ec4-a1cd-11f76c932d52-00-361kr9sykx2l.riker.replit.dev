import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { resolvePermissionCodesForRole } from "../lib/permission-resolver.js";

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7);
}

export async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return next(new HttpError(401, "Missing access token"));
  }

  const authResult = await supabaseAdmin.auth.getUser(token);
  if (authResult.error || !authResult.data.user) {
    return next(new HttpError(401, "Invalid or expired session"));
  }

  const user = authResult.data.user;
  const profileResult = await supabaseAdmin
    .from("app_users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (profileResult.error || !profileResult.data) {
    return next(new HttpError(403, "CRM profile not found for this account"));
  }

  var profile = profileResult.data;
  var permissions = await resolvePermissionCodesForRole(profile.role);

  req.auth = {
    token,
    user,
    profile,
    permissions
  };
  next();
}

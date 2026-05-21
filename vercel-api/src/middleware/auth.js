import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7);
}

function normalizeRole(role) {
  const value = String(role || "").trim().toUpperCase();
  if (value === "EXECUTIVE" || value === "COORDINATOR" || value === "TELECALLER") return "STAFF";
  if (value === "ACCOUNT") return "ACCOUNTANT";
  return value;
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
  let profileResult = await supabaseAdmin
    .from("app_users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (profileResult.error || !profileResult.data) {
    profileResult = await supabaseAdmin
      .from("hh_users")
      .select("*")
      .eq("email", user.email || "")
      .single();
  }

  if (profileResult.error || !profileResult.data) {
    return next(new HttpError(403, "CRM profile not found for this account"));
  }

  const profile = profileResult.data.auth_user_id
    ? profileResult.data
    : {
        id: profileResult.data.id,
        auth_user_id: user.id,
        full_name: profileResult.data.full_name || profileResult.data.name || profileResult.data.username || user.email,
        email: profileResult.data.email || user.email,
        role: normalizeRole(profileResult.data.role),
        mobile: profileResult.data.mobile || profileResult.data.phone || null,
        is_active: profileResult.data.is_active !== false
      };

  req.auth = {
    token,
    user,
    profile
  };
  next();
}

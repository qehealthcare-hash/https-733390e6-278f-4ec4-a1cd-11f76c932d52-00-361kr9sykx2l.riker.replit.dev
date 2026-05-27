import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Database } from "@/lib/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type AuthContext = {
  user: User;
  profile: Profile;
};

/** Current user from cookie session (server). */
export async function getUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[auth] getProfile", error.message);
    return null;
  }
  return data;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getUser();
  if (!user) return null;
  const profile = await getProfile(user.id);
  if (!profile) return null;
  return { user, profile };
}

/** True when onboarding fields are still default / empty. */
export function needsOnboarding(profile: Profile): boolean {
  if (!profile.class_or_target?.trim()) return true;
  if (profile.full_name.trim() === "Student") return true;
  return false;
}

type RequireAuthOptions = {
  /** Redirect here when not signed in. */
  loginPath?: string;
  /** If true, send incomplete profiles to /onboarding. */
  requireOnboarded?: boolean;
};

/**
 * Server-side auth guard for layouts and pages.
 * Redirects to login (with `next` param) when unauthenticated.
 */
export async function requireAuth(
  options: RequireAuthOptions = {},
): Promise<AuthContext> {
  const { loginPath = "/login", requireOnboarded = false } = options;

  if (!isSupabaseConfigured()) {
    redirect(`${loginPath}?error=supabase`);
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    redirect(loginPath);
  }

  if (requireOnboarded && needsOnboarding(ctx.profile)) {
    redirect("/onboarding");
  }

  return ctx;
}

/** Redirect signed-in users away from login/signup. */
export async function redirectIfAuthenticated(destination = "/dashboard") {
  const user = await getUser();
  if (user) {
    const profile = await getProfile(user.id);
    if (profile && needsOnboarding(profile)) {
      redirect("/onboarding");
    }
    redirect(destination);
  }
}

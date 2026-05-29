import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProfile, needsOnboarding } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * OAuth + magic-link callback — exchanges `code` for a session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login?error=supabase`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/login?error=supabase`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback]", error.message);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const profile = await getProfile(user.id);
    if (!profile || needsOnboarding(profile)) {
      return NextResponse.redirect(`${origin}/onboarding?next=${encodeURIComponent(safeNext)}`);
    }
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}

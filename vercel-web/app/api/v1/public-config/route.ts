import { NextResponse } from "next/server";
import { env } from "@/lib/api/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public Supabase client config for legacy static pages.
 * The anon key is not a secret (JWT with anon role) but must not be committed
 * in repository HTML — load at runtime from deployment env instead.
 */
export async function GET() {
  const url = env.supabaseUrl;
  const key = env.supabaseAnonKey;
  if (!key) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured" },
      { status: 503 }
    );
  }
  return NextResponse.json(
    { url, key },
    {
      headers: {
        "Cache-Control": "public, max-age=300"
      }
    }
  );
}

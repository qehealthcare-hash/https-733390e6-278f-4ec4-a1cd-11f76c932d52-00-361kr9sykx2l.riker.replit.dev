import { isSupabaseAdminConfigured, isSupabaseConfigured } from "@/lib/supabase/config";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/supabase — connectivity check for ops / milestone 9 verify.
 * Does not expose secrets.
 */
export async function GET() {
  const configured = isSupabaseConfigured();
  const adminConfigured = isSupabaseAdminConfigured();

  if (!configured) {
    return Response.json({
      ok: false,
      configured: false,
      adminConfigured: false,
      message: "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    });
  }

  if (!adminConfigured) {
    return Response.json({
      ok: true,
      configured: true,
      adminConfigured: false,
      message: "Anon client ready; service role key not set (jsonl fallback for leads).",
    });
  }

  try {
    const admin = tryCreateAdminClient();
    const { error } = await admin!.from("profiles").select("id", {
      head: true,
      count: "exact",
    });

    if (error) {
      return Response.json({
        ok: false,
        configured: true,
        adminConfigured: true,
        message: error.message,
      });
    }

    return Response.json({
      ok: true,
      configured: true,
      adminConfigured: true,
      message: "Connected.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({
      ok: false,
      configured: true,
      adminConfigured: true,
      message,
    });
  }
}

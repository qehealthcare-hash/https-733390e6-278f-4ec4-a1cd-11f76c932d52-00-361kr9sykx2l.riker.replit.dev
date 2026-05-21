import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/api/supabase";
import { hasOpenAI, hasWhatsApp } from "@/lib/api/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  let dbError = "";
  try {
    const { error } = await supabaseAdmin().from("hh_users").select("id", { count: "exact", head: true });
    dbOk = !error;
    dbError = error?.message || "";
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json({
    ok: true,
    service: "hominal-crm-api",
    version: 1,
    time: new Date().toISOString(),
    deps: {
      supabase: { ok: dbOk, error: dbError || null },
      openai: hasOpenAI(),
      whatsapp: hasWhatsApp()
    }
  });
}

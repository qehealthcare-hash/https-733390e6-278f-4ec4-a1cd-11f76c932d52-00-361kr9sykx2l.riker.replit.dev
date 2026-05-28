import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Returns the server's UTC ISO time so clients can anchor countdowns
 * against the authoritative clock instead of trusting the device.
 */
export async function GET() {
  return NextResponse.json(
    { now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

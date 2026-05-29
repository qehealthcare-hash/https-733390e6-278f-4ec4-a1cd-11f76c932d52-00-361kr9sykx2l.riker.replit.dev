import { NextResponse } from "next/server";
import { verifyCertificateCode } from "@/lib/exams/certificates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code") ?? "";
  const result = await verifyCertificateCode(code);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

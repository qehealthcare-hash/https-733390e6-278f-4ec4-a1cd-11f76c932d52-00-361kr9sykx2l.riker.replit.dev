import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicExamBySlug } from "@/lib/exams/public";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ count: 0 });
  }

  const exam = await getPublicExamBySlug(slug);
  if (!exam) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ count: exam.registration_count });
  }

  const { data, error } = await supabase
    .from("exam_public_stats")
    .select("registration_count")
    .eq("exam_id", exam.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ count: exam.registration_count });
  }

  return NextResponse.json(
    { count: data?.registration_count ?? exam.registration_count },
    {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
      },
    },
  );
}

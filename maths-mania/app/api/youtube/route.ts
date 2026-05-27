import { getChannelVideos, getLatestVideos } from "@/lib/youtube";

/**
 * ISR-cached JSON endpoint for client-side refresh (optional).
 * GET /api/youtube?limit=6
 * GET /api/youtube?limit=24&page=all
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    50,
    Math.max(1, Number(searchParams.get("limit") ?? "6")),
  );
  const mode = searchParams.get("page");

  const result =
    mode === "all"
      ? await getChannelVideos(limit)
      : await getLatestVideos(limit);

  return Response.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}

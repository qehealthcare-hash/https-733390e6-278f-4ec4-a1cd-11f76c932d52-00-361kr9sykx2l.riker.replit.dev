/** Lighter default thumbs for grids (mq = 320px wide). */
export function youtubeThumbnailUrl(
  videoId: string,
  quality: "mq" | "hq" = "mq",
): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}default.jpg`;
}

/** Prefer medium API thumb, else fall back to mqdefault for card grids. */
export function pickVideoThumbnail(
  videoId: string,
  apiUrl?: string | null,
): string {
  if (apiUrl?.includes("i.ytimg.com")) {
    return apiUrl.replace(/\/hqdefault\.jpg$/, "/mqdefault.jpg");
  }
  return youtubeThumbnailUrl(videoId, "mq");
}

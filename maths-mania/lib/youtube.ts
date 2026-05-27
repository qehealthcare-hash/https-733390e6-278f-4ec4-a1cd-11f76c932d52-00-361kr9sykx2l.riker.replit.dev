import { PLACEHOLDER_VIDEOS } from "@/lib/home-data";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const REVALIDATE_SEC = 3600;

const DEFAULT_CHANNEL_ID = "UCbPBJROEaXpSryqgrcybufA";

export type Video = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  /** Human-readable duration, e.g. "14:22". */
  duration: string;
  /** Formatted view count, e.g. "42K". */
  viewCount: string;
  viewCountRaw: number;
};

export type VideosResult = {
  videos: Video[];
  /** Whether data came from YouTube API or local placeholders. */
  source: "youtube" | "placeholder";
  nextPageToken?: string;
};

export type ChannelStats = {
  subscriberCount: string;
  videoCount: string;
  viewCount: string;
};

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

type YouTubeVideoItem = {
  id?: string;
  snippet?: YouTubeSearchItem["snippet"];
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
};

function getChannelId(): string {
  return process.env.YOUTUBE_CHANNEL_ID ?? DEFAULT_CHANNEL_ID;
}

function getApiKey(): string | undefined {
  return process.env.YOUTUBE_API_KEY?.trim() || undefined;
}

async function youtubeGet<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<T | null> {
  const key = getApiKey();
  if (!key) return null;

  const url = new URL(`${YOUTUBE_API}/${endpoint}`);
  url.searchParams.set("key", key);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: REVALIDATE_SEC },
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[youtube] ${endpoint} failed: ${res.status}`, body.slice(0, 200));
      return null;
    }

    return (await res.json()) as T;
  } catch (err) {
    console.warn("[youtube] fetch error", err);
    return null;
  }
}

/** Parse ISO 8601 duration (PT1H2M3S) → mm:ss or h:mm:ss */
export function formatIsoDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "0:00";
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  const s = Number(match[3] ?? 0);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatViewCount(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}K`;
  }
  return String(count);
}

export function formatRelativeDate(dateIso: string): string {
  const days = Math.floor(
    (Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function placeholdersToVideos(): Video[] {
  return PLACEHOLDER_VIDEOS.map((v) => ({
    id: v.id,
    title: v.title,
    description: "",
    thumbnail: v.thumbnail,
    publishedAt: v.publishedAt,
    duration: v.duration,
    viewCount: v.viewCount,
    viewCountRaw: 0,
  }));
}

async function enrichVideos(searchItems: YouTubeSearchItem[]): Promise<Video[]> {
  const ids = searchItems
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) return [];

  const details = await youtubeGet<{ items?: YouTubeVideoItem[] }>("videos", {
    part: "snippet,contentDetails,statistics",
    id: ids.join(","),
  });

  const detailMap = new Map(
    (details?.items ?? []).map((item) => [item.id!, item]),
  );

  return ids
    .map((id) => {
      const searchItem = searchItems.find((s) => s.id?.videoId === id);
      const detail = detailMap.get(id);
      const snippet = detail?.snippet ?? searchItem?.snippet;
      if (!snippet?.title) return null;

      const thumbs = snippet.thumbnails;
      const thumbnail =
        thumbs?.high?.url ??
        thumbs?.medium?.url ??
        thumbs?.default?.url ??
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

      const rawViews = Number(detail?.statistics?.viewCount ?? 0);

      return {
        id,
        title: snippet.title,
        description: snippet.description ?? "",
        thumbnail,
        publishedAt: snippet.publishedAt ?? new Date().toISOString(),
        duration: formatIsoDuration(
          detail?.contentDetails?.duration ?? "PT0S",
        ),
        viewCount: rawViews > 0 ? formatViewCount(rawViews) : "—",
        viewCountRaw: rawViews,
      } satisfies Video;
    })
    .filter((v): v is Video => v !== null);
}

/**
 * Fetch the latest uploads from the configured channel.
 * ISR-cached for 1 hour. Falls back to curated placeholders if the
 * API key is missing or the request fails.
 */
export async function getLatestVideos(limit = 6): Promise<VideosResult> {
  const channelId = getChannelId();

  const search = await youtubeGet<{
    items?: YouTubeSearchItem[];
    nextPageToken?: string;
  }>("search", {
    part: "snippet",
    channelId,
    order: "date",
    type: "video",
    maxResults: String(Math.min(limit, 50)),
  });

  if (!search?.items?.length) {
    if (!getApiKey()) {
      console.warn("[youtube] YOUTUBE_API_KEY not set — using placeholders");
    }
    return {
      videos: placeholdersToVideos().slice(0, limit),
      source: "placeholder",
    };
  }

  const videos = await enrichVideos(search.items);
  if (videos.length === 0) {
    return {
      videos: placeholdersToVideos().slice(0, limit),
      source: "placeholder",
    };
  }

  return {
    videos: videos.slice(0, limit),
    source: "youtube",
    nextPageToken: search.nextPageToken,
  };
}

/**
 * Paginated channel videos for /videos page.
 */
export async function getChannelVideos(
  limit = 24,
  pageToken?: string,
): Promise<VideosResult> {
  const channelId = getChannelId();

  const params: Record<string, string> = {
    part: "snippet",
    channelId,
    order: "date",
    type: "video",
    maxResults: String(Math.min(limit, 50)),
  };
  if (pageToken) params.pageToken = pageToken;

  const search = await youtubeGet<{
    items?: YouTubeSearchItem[];
    nextPageToken?: string;
  }>("search", params);

  if (!search?.items?.length) {
    return {
      videos: placeholdersToVideos(),
      source: "placeholder",
    };
  }

  const videos = await enrichVideos(search.items);
  return {
    videos: videos.length > 0 ? videos : placeholdersToVideos(),
    source: videos.length > 0 ? "youtube" : "placeholder",
    nextPageToken: search.nextPageToken,
  };
}

/**
 * Channel subscriber / video / view totals for About page (future).
 */
export async function getChannelStats(): Promise<ChannelStats | null> {
  const data = await youtubeGet<{
    items?: Array<{
      statistics?: {
        subscriberCount?: string;
        videoCount?: string;
        viewCount?: string;
      };
    }>;
  }>("channels", {
    part: "statistics",
    id: getChannelId(),
  });

  const stats = data?.items?.[0]?.statistics;
  if (!stats) return null;

  return {
    subscriberCount: stats.subscriberCount ?? "0",
    videoCount: stats.videoCount ?? "0",
    viewCount: stats.viewCount ?? "0",
  };
}

/** Privacy-friendly embed URL (youtube-nocookie.com). */
export function getEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
}

export function hasYoutubeApiKey(): boolean {
  return Boolean(getApiKey());
}

"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { VideoCard } from "@/components/sections/video-card";
import { VideoModal } from "@/components/sections/video-modal";
import { SITE } from "@/lib/site";
import type { Video, VideosResult } from "@/lib/youtube";
import { cn } from "@/lib/utils";

function isEmbeddable(video: Video, source: VideosResult["source"]): boolean {
  return source === "youtube" && !video.id.startsWith("v");
}

type TrackFilter = "all" | "school" | "banking" | "ssc" | "tricks";

const FILTERS: { id: TrackFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "school", label: "School" },
  { id: "banking", label: "Banking" },
  { id: "ssc", label: "SSC" },
  { id: "tricks", label: "Tricks" },
];

const TRACK_KEYWORDS: Record<Exclude<TrackFilter, "all">, string[]> = {
  school: ["class", "cbse", "board", "trigonometry", "geometry", "ncert", "gujarat"],
  banking: ["ibps", "sbi", "banking", "di ", "data interpretation", "po ", "clerk"],
  ssc: ["ssc", "cgl", "chsl", "railway", "mts", "competitive"],
  tricks: ["trick", "vedic", "shortcut", "multiply", "square", "speed"],
};

function matchesTrack(title: string, track: TrackFilter): boolean {
  if (track === "all") return true;
  const lower = title.toLowerCase();
  return TRACK_KEYWORDS[track].some((kw) => lower.includes(kw));
}

type SortMode = "newest" | "views";

type VideosLibraryProps = {
  videos: Video[];
  source: "youtube" | "placeholder";
};

export function VideosLibrary({ videos, source }: VideosLibraryProps) {
  const [query, setQuery] = React.useState("");
  const [track, setTrack] = React.useState<TrackFilter>("all");
  const [sort, setSort] = React.useState<SortMode>("newest");
  const [active, setActive] = React.useState<Video | null>(null);
  const [open, setOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    let list = videos.filter((v) => matchesTrack(v.title, track));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((v) => v.title.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      if (sort === "views") {
        return b.viewCountRaw - a.viewCountRaw;
      }
      return (
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
    });
    return list;
  }, [videos, track, query, sort]);

  return (
    <>
      {source === "placeholder" && (
        <p className="mb-6 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          Add <code className="font-mono text-xs">YOUTUBE_API_KEY</code> to{" "}
          <code className="font-mono text-xs">.env.local</code> to load real channel
          uploads. Showing curated placeholders until then.
        </p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search video titles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={cn(
              "h-11 w-full rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] pl-11 pr-4 text-sm",
              "text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]",
            )}
            aria-label="Search videos"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="video-sort" className="sr-only">
            Sort videos
          </label>
          <select
            id="video-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="h-10 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm text-[var(--color-text)]"
          >
            <option value="newest">Newest</option>
            <option value="views">Most viewed</option>
          </select>
        </div>
      </div>

      <div
        className="mt-4 flex flex-wrap gap-2"
        role="group"
        aria-label="Filter by track"
      >
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setTrack(f.id)}
            aria-pressed={track === f.id}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              track === f.id
                ? "bg-[var(--color-primary-500)] text-white"
                : "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="mt-12 text-center text-[var(--color-text-muted)]">
          No videos match your search. Try a different filter or keyword.
        </p>
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((video) => (
            <li key={video.id}>
              <VideoCard
                video={video}
                onPlay={(v) => {
                  if (!isEmbeddable(v, source)) {
                    window.open(
                      SITE.social.youtube,
                      "_blank",
                      "noopener,noreferrer",
                    );
                    return;
                  }
                  setActive(v);
                  setOpen(true);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <VideoModal
        video={active}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setActive(null);
        }}
      />
    </>
  );
}

"use client";

import Image from "next/image";
import { Play } from "lucide-react";
import { formatRelativeDate, type Video } from "@/lib/youtube";
import { cn } from "@/lib/utils";

type VideoCardProps = {
  video: Video;
  onPlay: (video: Video) => void;
  className?: string;
};

export function VideoCard({ video, onPlay, className }: VideoCardProps) {
  const isPlaceholder = video.id.startsWith("v");

  return (
    <button
      type="button"
      onClick={() => onPlay(video)}
      className={cn(
        "group w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] text-left shadow-[var(--shadow-soft)]",
        "transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]",
        "focus-visible:outline-none",
        className,
      )}
    >
      <div className="relative aspect-video bg-[var(--color-surface-alt)]">
        <Image
          src={video.thumbnail}
          alt=""
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 33vw"
          loading="lazy"
          unoptimized={isPlaceholder}
        />
        <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-xs text-white">
          {video.duration}
        </span>
        <span
          className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/25 group-hover:opacity-100 group-focus-visible:bg-black/25 group-focus-visible:opacity-100"
          aria-hidden
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-[var(--color-primary-500)] text-white shadow-lg">
            <Play className="size-7 translate-x-0.5" fill="currentColor" />
          </span>
        </span>
      </div>
      <span className="block p-4">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--color-text)]">
          {video.title}
        </span>
        <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
          {formatRelativeDate(video.publishedAt)}
          {video.viewCount !== "—" && ` · ${video.viewCount} views`}
        </span>
      </span>
    </button>
  );
}

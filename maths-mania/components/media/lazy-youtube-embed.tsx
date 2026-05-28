"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

type LazyYouTubeEmbedProps = {
  src: string;
  title: string;
  /** Optional poster (e.g. first video in playlist). */
  posterUrl?: string;
  className?: string;
  /** Load iframe when near viewport (default) or only after click. */
  strategy?: "viewport" | "click";
};

/**
 * Defers youtube-nocookie iframe until in view or user clicks —
 * avoids pulling ~500KB+ of embed JS on initial page load (m18 perf).
 */
export function LazyYouTubeEmbed({
  src,
  title,
  posterUrl,
  className,
  strategy = "viewport",
}: LazyYouTubeEmbedProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(strategy === "click");

  React.useEffect(() => {
    if (active || strategy !== "viewport") return;
    const el = rootRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px", threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, strategy]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-black",
        className,
      )}
    >
      {active ? (
        <iframe
          src={src}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setActive(true)}
          className="group absolute inset-0 flex w-full flex-col items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
          aria-label={`Load video: ${title}`}
        >
          {posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- poster only; iframe loads after activate
            <img
              src={posterUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover opacity-80"
            />
          ) : null}
          <span className="absolute inset-0 bg-black/35 transition group-hover:bg-black/45" />
          <span className="relative flex size-16 items-center justify-center rounded-full bg-[var(--color-primary-500)] text-white shadow-lg transition group-hover:scale-105">
            <Play className="size-8 translate-x-0.5" fill="currentColor" aria-hidden />
          </span>
          <span className="relative mt-3 max-w-[90%] px-4 text-center text-sm font-semibold text-white drop-shadow">
            {title}
          </span>
        </button>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { VideoCard } from "@/components/sections/video-card";
import { VideoModal } from "@/components/sections/video-modal";
import { SITE } from "@/lib/site";
import type { Video, VideosResult } from "@/lib/youtube";

type VideoGridClientProps = {
  videos: Video[];
  source: VideosResult["source"];
};

function isEmbeddable(video: Video, source: VideosResult["source"]): boolean {
  return source === "youtube" && !video.id.startsWith("v");
}

export function VideoGridClient({ videos, source }: VideoGridClientProps) {
  const [active, setActive] = React.useState<Video | null>(null);
  const [open, setOpen] = React.useState(false);

  function handlePlay(video: Video) {
    if (!isEmbeddable(video, source)) {
      window.open(SITE.social.youtube, "_blank", "noopener,noreferrer");
      return;
    }
    setActive(video);
    setOpen(true);
  }

  return (
    <>
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => (
          <li key={video.id}>
            <VideoCard video={video} onPlay={handlePlay} />
          </li>
        ))}
      </ul>
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

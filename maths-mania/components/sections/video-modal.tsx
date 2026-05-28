"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { getEmbedUrl, type Video } from "@/lib/youtube";
import { cn } from "@/lib/utils";

type VideoModalProps = {
  video: Video | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * In-page YouTube player via youtube-nocookie.com (no tracking cookies).
 */
export function VideoModal({ video, open, onOpenChange }: VideoModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(100vw-2rem,900px)] -translate-x-1/2 -translate-y-1/2",
            "rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-2xl",
            "focus:outline-none",
          )}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">
            {video ? `Playing: ${video.title}` : "Video player"}
          </Dialog.Title>

          <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] bg-black">
            {video && open && (
              <iframe
                src={getEmbedUrl(video.id)}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="absolute inset-0 size-full border-0"
              />
            )}
          </div>

          {video && (
            <p className="px-3 py-3 text-sm font-semibold leading-snug text-[var(--color-text)] line-clamp-2">
              {video.title}
            </p>
          )}

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close video"
              className="absolute -right-2 -top-2 flex size-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-lg hover:bg-[var(--color-surface-alt)]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

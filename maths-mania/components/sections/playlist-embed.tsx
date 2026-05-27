import Link from "next/link";
import { SITE } from "@/lib/site";
import { getPlaylistId } from "@/lib/courses";
import type { CourseDetail } from "@/lib/courses";

type PlaylistEmbedProps = {
  playlistEnvKey: CourseDetail["playlistEnvKey"];
  title: string;
};

/**
 * Embeds a YouTube playlist when NEXT_PUBLIC_PLAYLIST_* is set.
 * Otherwise shows a link to the channel with setup instructions for admins.
 */
export function PlaylistEmbed({ playlistEnvKey, title }: PlaylistEmbedProps) {
  const playlistId = playlistEnvKey ? getPlaylistId(playlistEnvKey) : undefined;

  if (playlistId) {
    return (
      <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-black shadow-[var(--shadow-card)]">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full border-0"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] p-8 text-center">
      <p className="font-semibold text-[var(--color-text)]">
        Playlist embed coming soon
      </p>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Watch the full track on our YouTube channel — all lessons are free.
      </p>
      <Link
        href={SITE.social.youtube}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex items-center justify-center rounded-full bg-[var(--color-primary-500)] px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow-soft)] hover:bg-[var(--color-primary-600)]"
      >
        Open Maths Mania on YouTube ▶
      </Link>
      <p className="mt-4 font-mono text-[10px] text-[var(--color-text-faint)]">
        Admins: set {playlistEnvKey ? `NEXT_PUBLIC_${playlistEnvKey}` : "playlist env"} in .env.local
      </p>
    </div>
  );
}

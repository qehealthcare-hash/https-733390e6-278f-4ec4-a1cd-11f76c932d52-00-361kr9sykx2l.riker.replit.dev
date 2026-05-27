import Link from "next/link";
import Image from "next/image";
import { Play } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { PLACEHOLDER_VIDEOS } from "@/lib/home-data";

function formatRelative(dateIso: string): string {
  const days = Math.floor(
    (Date.now() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * Latest videos — placeholder grid until YouTube API (milestone 4).
 * Shows a note when YOUTUBE_API_KEY is absent.
 */
export function VideoGridSection() {
  const hasApiKey = Boolean(process.env.YOUTUBE_API_KEY);

  return (
    <Section padding="lg" tone="alt" id="videos">
      <Container>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow tone="secondary">YouTube</Eyebrow>
            <Heading as="h2" size="h2" className="mt-3">
              Fresh from the channel
            </Heading>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/videos">View all videos</Link>
          </Button>
        </div>

        {!hasApiKey && (
          <p className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
            Connect <code className="font-mono text-xs">YOUTUBE_API_KEY</code> in{" "}
            <code className="font-mono text-xs">.env.local</code> to auto-sync the
            latest uploads. Showing curated placeholders until then.
          </p>
        )}

        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PLACEHOLDER_VIDEOS.map((video) => (
            <li key={video.id}>
              <a
                href="https://www.youtube.com/channel/UCbPBJROEaXpSryqgrcybufA"
                target="_blank"
                rel="noopener noreferrer"
                className="group block overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
              >
                <div className="relative aspect-video bg-[var(--color-surface-alt)]">
                  <Image
                    src={video.thumbnail}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                  />
                  <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-xs text-white">
                    {video.duration}
                  </span>
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/20 group-hover:opacity-100">
                    <Play className="size-12 text-white" fill="white" aria-hidden />
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--color-text)]">
                    {video.title}
                  </h3>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {formatRelative(video.publishedAt)} · {video.viewCount} views
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}

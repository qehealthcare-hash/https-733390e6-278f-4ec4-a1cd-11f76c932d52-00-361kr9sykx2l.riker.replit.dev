import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { VideoGridSkeleton } from "@/components/sections/video-grid-skeleton";
import { getLatestVideos, hasYoutubeApiKey } from "@/lib/youtube";
import { Suspense } from "react";

const VideoGridClient = dynamic(
  () =>
    import("@/components/sections/video-grid-client").then((m) => ({
      default: m.VideoGridClient,
    })),
  { loading: () => <VideoGridSkeleton count={6} className="mt-10" /> },
);

async function VideoGridContent() {
  const { videos, source } = await getLatestVideos(6);

  return (
    <>
      {source === "placeholder" && !hasYoutubeApiKey() && (
        <p className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          Connect <code className="font-mono text-xs">YOUTUBE_API_KEY</code> in{" "}
          <code className="font-mono text-xs">.env.local</code> to auto-sync the
          latest uploads from the channel. Showing curated placeholders until then.
        </p>
      )}
      {source === "youtube" && (
        <p className="mt-4 text-xs text-[var(--color-text-muted)]">
          Synced from YouTube · updates hourly
        </p>
      )}
      <div className="mt-10">
        <VideoGridClient videos={videos} source={source} />
      </div>
    </>
  );
}

/**
 * Home — latest 6 videos from YouTube Data API v3 (ISR 1h) or placeholders.
 */
export function VideoGridSection() {
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

        <Suspense fallback={<VideoGridSkeleton count={6} className="mt-10" />}>
          <VideoGridContent />
        </Suspense>
      </Container>
    </Section>
  );
}

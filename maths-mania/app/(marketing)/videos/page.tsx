import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { VideosLibrary } from "@/components/sections/videos-library";
import { VideoGridSkeleton } from "@/components/sections/video-grid-skeleton";
import { getChannelVideos } from "@/lib/youtube";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Videos — Fresh from the YouTube channel",
  description:
    "Every Maths Mania video, auto-synced from the YouTube channel. Search, filter by track, and watch in-page.",
};

async function VideosContent() {
  const { videos, source } = await getChannelVideos(24);

  return <VideosLibrary videos={videos} source={source} />;
}

export default function VideosPage() {
  return (
    <Section padding="lg" tone="default">
      <Container>
        <Eyebrow tone="secondary">YouTube</Eyebrow>
        <Heading as="h1" size="h1" className="mt-4">
          All videos
        </Heading>
        <p className="mt-4 max-w-2xl text-lg text-[var(--color-text-muted)]">
          Step-by-step lessons for school boards, banking, SSC, and smart maths
          tricks — watch here without leaving the site.
        </p>

        <div className="mt-10">
          <Suspense fallback={<VideoGridSkeleton count={12} />}>
            <VideosContent />
          </Suspense>
        </div>
      </Container>
    </Section>
  );
}

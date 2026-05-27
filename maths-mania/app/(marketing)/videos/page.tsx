import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Videos — Fresh from the YouTube channel",
  description:
    "Every Maths Mania video, auto-synced from the YouTube channel and filterable by track. Watch directly here without leaving the site.",
};

export default function VideosPage() {
  return (
    <ComingSoon
      milestone="Milestone 4"
      title="The full video library"
      subhead="Once the YouTube Data API key is plugged in, this page lists every video on the channel — searchable, filterable by track, paginated, and watchable in-page via a privacy-friendly youtube-nocookie embed."
      features={[
        "All videos with thumbnails + view counts + duration",
        "Filter chips: School · Banking · SSC · Tricks",
        "Search across video titles",
        "Sort by newest or most-viewed",
        "Click to open in modal player (no tracking cookies)",
      ]}
    />
  );
}

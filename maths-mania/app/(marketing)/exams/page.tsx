import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Live Exams — Free All-India Mock Tests",
  description:
    "Free synchronized 30-minute live mock exams every Sunday. Auto-graded scorecard, All-India merit list, downloadable certificate for top 10%.",
};

export default function ExamsPage() {
  return (
    <ComingSoon
      milestone="Milestone 12-14"
      title="The flagship: synchronized All-India live exams"
      subhead="Sunday, 11 AM IST, the whole country writes the same test. Free, 30-minute, auto-graded, ranked, certified. This page is being built as the next-priority milestone after the marketing foundation."
      features={[
        "Upcoming exams hub with live countdown",
        "Anti-cheat lobby with system check + fullscreen lock",
        "Real attempt UI with autosave + question palette",
        "All-India merit list within 60 minutes of close",
        "Downloadable PDF certificate for top 10%",
      ]}
      cta={{ label: "Get notified when it opens", href: "/#newsletter" }}
    />
  );
}

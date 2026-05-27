import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "About — Beyond Numbers",
  description:
    "Our story, our teaching philosophy, and why we built Maths Mania for Indian students.",
};

export default function AboutPage() {
  return (
    <ComingSoon
      milestone="Milestone 16"
      title="About Maths Mania"
      subhead="Founder story, teaching philosophy, stats and the why-behind-the-why will land here. For now: we believe maths becomes easy the moment the method is right."
    />
  );
}

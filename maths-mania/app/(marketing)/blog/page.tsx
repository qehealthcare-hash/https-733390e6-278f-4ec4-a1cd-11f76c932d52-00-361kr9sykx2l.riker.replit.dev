import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Blog — Smart Maths Tricks & Exam Strategy",
  description:
    "Long-form posts: shortcut tricks, exam strategy, topic breakdowns and high-frequency question patterns. Free to read.",
};

export default function BlogPage() {
  return (
    <ComingSoon
      milestone="Milestone 7"
      title="The blog"
      subhead="MDX-powered long-form content with proper KaTeX rendering for every formula. Four launch posts already drafted in the milestone-7 plan."
      features={[
        "Multiply any 2-digit number by 11 instantly",
        "The fastest method to find the square of any number ending in 5",
        "Banking Quant — 5 high-frequency DI patterns in 2025",
        "Class 10 Trigonometry — the 3 identities you must memorise",
      ]}
    />
  );
}

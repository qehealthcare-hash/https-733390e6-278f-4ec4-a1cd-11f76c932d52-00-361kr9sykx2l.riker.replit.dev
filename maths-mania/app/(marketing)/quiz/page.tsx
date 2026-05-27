import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Practice Quiz — Self-paced, un-timed, free",
  description:
    "Diagnostic quizzes by class/exam/topic. No timer, no auth, no ranking — just practice and instant feedback.",
};

export default function QuizPage() {
  return (
    <ComingSoon
      milestone="Milestone 8"
      title="Self-paced practice quizzes"
      subhead="Casual diagnostic quizzes (no auth, no ranking, no schedule) — the laid-back cousin of the Live Exams flagship. Three launch quizzes already designed: Class 10 Trigonometry, IBPS Quant Mock, SSC CGL Percentages."
      features={[
        "Anonymous — no signup needed",
        "KaTeX-rendered formulas in every question",
        "Instant explanation after each answer",
        "Topic-wise breakdown at the end",
        "Soft CTA into the real live-exam pillar",
      ]}
    />
  );
}

import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Courses — School, Banking, SSC, Tricks, Live Exams",
  description:
    "Five tracks designed for Indian students: Class 1–10 school maths (CBSE & Gujarat Board), banking quant, SSC competitive aptitude, smart shortcut tricks, and live mock exams.",
};

export default function CoursesPage() {
  return (
    <ComingSoon
      milestone="Milestone 5"
      title="Five tracks. One method."
      subhead="Learn the concepts. Practice the tricks. Then prove it on a live All-India exam. The full courses hub with pillar-specific syllabus, embedded YouTube playlists, and downloads is queued for milestone 5."
      features={[
        "School Maths — Class 1 to 10 (CBSE / Gujarat Board / State Boards)",
        "Banking Quant — IBPS / SBI / RBI Grade B / NABARD",
        "SSC & Competitive Aptitude — CGL, CHSL, MTS, Railways",
        "Smart Tricks — Vedic, speed maths, mental calculation",
        "Real-Time Exams — All-India ranked weekly mocks",
      ]}
    />
  );
}

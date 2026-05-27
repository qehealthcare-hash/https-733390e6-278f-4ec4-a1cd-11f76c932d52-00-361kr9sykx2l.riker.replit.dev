import type { Metadata } from "next";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Student Testimonials",
  description:
    "Real stories from students who cracked their exams or jumped their school maths grades using Maths Mania.",
};

export default function TestimonialsPage() {
  return (
    <ComingSoon
      milestone="Milestone 16"
      title="From our students"
      subhead="Full testimonials wall with filters by exam/class, plus a submit-your-story form so future toppers can join. Six launch testimonials already drafted."
    />
  );
}

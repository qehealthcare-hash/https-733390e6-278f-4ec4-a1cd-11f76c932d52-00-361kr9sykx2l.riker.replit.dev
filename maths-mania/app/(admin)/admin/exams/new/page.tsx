import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { ExamForm } from "@/components/admin/exam-form";

export const metadata: Metadata = {
  title: "Admin — New exam",
};

export default function AdminNewExamPage() {
  return (
    <>
      <Link
        href="/admin/exams"
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All exams
      </Link>
      <Heading as="h1" size="h2" className="mt-4">
        Create exam
      </Heading>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Set the schedule and marking scheme, then add questions on the next screen.
      </p>
      <div className="mt-8">
        <ExamForm />
      </div>
    </>
  );
}

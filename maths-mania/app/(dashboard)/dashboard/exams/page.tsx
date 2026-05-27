import type { Metadata } from "next";
import Link from "next/link";
import { Heading } from "@/components/ui/heading";

export const metadata: Metadata = {
  title: "My exams",
};

export default function DashboardExamsPage() {
  return (
    <>
      <Heading as="h1" size="h2">
        My exams
      </Heading>
      <p className="mt-4 text-[var(--color-text-muted)]">
        Registered and completed live mocks will appear here in milestone 12+.
        For now, browse upcoming exams on the{" "}
        <Link href="/exams" className="font-semibold text-[var(--color-primary-600)]">
          exams hub
        </Link>
        .
      </p>
    </>
  );
}

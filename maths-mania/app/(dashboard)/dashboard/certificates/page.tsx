import type { Metadata } from "next";
import Link from "next/link";
import { Heading } from "@/components/ui/heading";

export const metadata: Metadata = {
  title: "Certificates",
};

export default function DashboardCertificatesPage() {
  return (
    <>
      <Heading as="h1" size="h2">
        Certificates
      </Heading>
      <p className="mt-4 text-[var(--color-text-muted)]">
        Merit certificates for top rankers are issued after live exams (milestone
        14). Verify any certificate at{" "}
        <Link
          href="/certificates/verify"
          className="font-semibold text-[var(--color-primary-600)]"
        >
          certificate verification
        </Link>
        .
      </p>
    </>
  );
}

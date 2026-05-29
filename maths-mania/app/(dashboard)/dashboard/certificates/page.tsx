import type { Metadata } from "next";
import Link from "next/link";
import { Award, ArrowRight } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/session";
import { listCertificatesForUser } from "@/lib/exams/certificates";
import { formatExamScheduleIST } from "@/lib/exams/public";

export const metadata: Metadata = {
  title: "Certificates",
};

export const dynamic = "force-dynamic";

export default async function DashboardCertificatesPage() {
  const { user } = await requireAuth({ requireOnboarded: true });
  const certificates = await listCertificatesForUser(user.id);

  return (
    <>
      <Heading as="h1" size="h2">
        Certificates
      </Heading>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Certificates for top 10% rankers after merit publish. Verify authenticity
        at{" "}
        <Link
          href="/certificates/verify"
          className="font-semibold text-[var(--color-primary-600)]"
        >
          certificate verification
        </Link>
        .
      </p>

      {certificates.length === 0 ? (
        <p className="mt-10 text-sm text-[var(--color-text-muted)]">
          No certificates yet. Finish in the top 10% of a live exam after the
          merit list is published.
        </p>
      ) : (
        <ul className="mt-10 space-y-4">
          {certificates.map((cert) => (
            <li
              key={cert.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
            >
              <div className="flex items-start gap-3">
                <Award
                  className="mt-0.5 size-5 text-[var(--color-primary-600)]"
                  aria-hidden
                />
                <div>
                  <h2 className="font-display font-bold text-[var(--color-text)]">
                    {cert.exam_title}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    AIR #{cert.all_india_rank} · Score{" "}
                    {cert.final_score?.toFixed(2)} ·{" "}
                    {formatExamScheduleIST(cert.issued_at)}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[var(--color-text-faint)]">
                    {cert.verification_code}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" variant="primary">
                <Link href={`/dashboard/certificates/${cert.id}`}>
                  View & print
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

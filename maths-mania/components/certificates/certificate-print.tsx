import { SITE } from "@/lib/site";
import type { UserCertificate } from "@/lib/exams/certificates";
import { formatExamScheduleIST } from "@/lib/exams/public";

type CertificatePrintProps = {
  cert: UserCertificate;
};

export function CertificatePrint({ cert }: CertificatePrintProps) {
  return (
    <article className="certificate-print mx-auto max-w-3xl rounded-[var(--radius-xl)] border-4 border-[var(--color-primary-500)] bg-[var(--color-surface)] p-10 text-center shadow-[var(--shadow-card)] print:border-4 print:shadow-none">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-primary-600)]">
        {SITE.name}
      </p>
      <h1 className="mt-4 font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
        Certificate of Merit
      </h1>
      <p className="mt-6 text-[var(--color-text-muted)]">
        This certifies outstanding performance in
      </p>
      <p className="mt-2 font-display text-xl font-bold text-[var(--color-text)]">
        {cert.exam_title}
      </p>
      <p className="mt-8 text-lg text-[var(--color-text-muted)]">
        All-India Rank
      </p>
      <p className="font-display text-6xl font-bold tabular-nums text-[var(--color-primary-600)]">
        #{cert.all_india_rank}
      </p>
      <p className="mt-4 text-lg">
        Score{" "}
        <span className="font-mono font-bold tabular-nums">
          {cert.final_score?.toFixed(2) ?? "—"}
        </span>
      </p>
      <p className="mt-10 text-sm text-[var(--color-text-faint)]">
        Issued {formatExamScheduleIST(cert.issued_at)} · Verify at{" "}
        {SITE.url}/certificates/verify
      </p>
      <p className="mt-4 font-mono text-sm tracking-widest text-[var(--color-text-muted)]">
        {cert.verification_code}
      </p>
    </article>
  );
}

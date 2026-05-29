"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { VerifyCertificateResult } from "@/lib/exams/certificates";
import { cn } from "@/lib/utils";

export function CertificateVerifyForm({ className }: { className?: string }) {
  const [code, setCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<VerifyCertificateResult | null>(
    null,
  );
  const [searched, setSearched] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSearched(true);
    const res = await fetch(
      `/api/certificates/verify?code=${encodeURIComponent(code.trim())}`,
    );
    if (res.ok) {
      const data = (await res.json()) as VerifyCertificateResult;
      setResult(data);
    } else {
      setResult({
        valid: false,
        exam_title: null,
        display_name: null,
        final_score: null,
        all_india_rank: null,
        percentile: null,
        issued_at: null,
      });
    }
    setLoading(false);
  }

  return (
    <div className={cn("space-y-6", className)}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="cert-code">
          Verification code
        </label>
        <input
          id="cert-code"
          name="code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. A1B2C3D4E5F6"
          maxLength={12}
          className="h-11 min-w-[14rem] flex-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 font-mono text-sm uppercase tracking-widest text-[var(--color-text)]"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="primary" disabled={loading || code.length < 8}>
          {loading ? "Checking…" : "Verify"}
        </Button>
      </form>

      {searched && result && (
        <div
          role="status"
          className={cn(
            "rounded-[var(--radius-lg)] border px-5 py-4",
            result.valid
              ? "border-[var(--color-success)]/40 bg-green-50/80 dark:bg-green-950/20"
              : "border-[var(--color-error)]/40 bg-red-50/80 dark:bg-red-950/20",
          )}
        >
          {result.valid ? (
            <>
              <p className="font-display text-lg font-bold text-[var(--color-text)]">
                Valid certificate
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--color-text-muted)]">Exam</dt>
                  <dd className="font-medium">{result.exam_title}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted)]">Student</dt>
                  <dd className="font-medium">{result.display_name}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted)]">All-India rank</dt>
                  <dd className="font-mono font-bold">#{result.all_india_rank}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted)]">Score</dt>
                  <dd className="font-mono">
                    {result.final_score?.toFixed(2)}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="text-[var(--color-error)]">
              No certificate found for that code. Check the 12 characters and try
              again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

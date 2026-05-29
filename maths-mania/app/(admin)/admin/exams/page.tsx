import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { ExamStatusBadge } from "@/components/admin/exam-status-badge";
import { listExamsForAdmin } from "@/lib/exams/admin-data";
import { formatPillar, toIstDatetimeLocal } from "@/lib/exams/format";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Admin — Exams",
};

export default async function AdminExamsPage() {
  const exams = await listExamsForAdmin();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Heading as="h1" size="h2">
          Exams
        </Heading>
        <Button variant="primary" size="md" asChild>
          <Link href="/admin/exams/new">
            <Plus className="size-4" aria-hidden />
            New exam
          </Link>
        </Button>
      </div>

      {!isSupabaseConfigured() && (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          Supabase is not configured. Add env vars and run migrations to manage exams.
        </p>
      )}

      {exams.length === 0 ? (
        <p className="mt-8 text-[var(--color-text-muted)]">
          No exams in the database. Create one, or run{" "}
          <code className="text-xs">supabase db reset</code> to apply the demo seed migration.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Pillar</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Starts (IST)</th>
                <th className="px-4 py-3 font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((exam) => (
                <tr key={exam.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/exams/${exam.id}`}
                      className="font-semibold text-[var(--color-primary-600)] hover:underline"
                    >
                      {exam.title}
                    </Link>
                    <p className="text-xs text-[var(--color-text-faint)]">{exam.slug}</p>
                  </td>
                  <td className="px-4 py-3 capitalize">{formatPillar(exam.pillar)}</td>
                  <td className="px-4 py-3">
                    <ExamStatusBadge status={exam.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {toIstDatetimeLocal(exam.starts_at).replace("T", " ")}
                  </td>
                  <td className="px-4 py-3">{exam.duration_min} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

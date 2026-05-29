import type { Metadata } from "next";
import { Suspense } from "react";
import { Heading } from "@/components/ui/heading";
import { LoginForm } from "@/components/auth/login-form";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create account",
  description: "Join Maths Mania — free live mocks, practice quizzes, and study resources.",
};

export default async function SignupPage() {
  await redirectIfAuthenticated();

  return (
    <>
      <Heading as="h1" size="h2">
        Create your account
      </Heading>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Free forever for students. No card required.
      </p>
      <Suspense fallback={<p className="mt-8 text-sm text-[var(--color-text-muted)]">Loading…</p>}>
        <LoginForm mode="signup" className="mt-8" />
      </Suspense>
    </>
  );
}

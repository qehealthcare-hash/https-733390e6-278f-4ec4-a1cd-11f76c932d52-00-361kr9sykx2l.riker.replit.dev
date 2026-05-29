import type { Metadata } from "next";
import { Suspense } from "react";
import { Heading } from "@/components/ui/heading";
import { LoginForm } from "@/components/auth/login-form";
import { redirectIfAuthenticated } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Maths Mania with email, Google, or phone OTP.",
};

export default async function LoginPage() {
  await redirectIfAuthenticated();

  return (
    <>
      <Heading as="h1" size="h2">
        Welcome back
      </Heading>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Sign in to register for live exams, track attempts, and download
        certificates.
      </p>
      <Suspense fallback={<p className="mt-8 text-sm text-[var(--color-text-muted)]">Loading…</p>}>
        <LoginForm mode="login" className="mt-8" />
      </Suspense>
    </>
  );
}

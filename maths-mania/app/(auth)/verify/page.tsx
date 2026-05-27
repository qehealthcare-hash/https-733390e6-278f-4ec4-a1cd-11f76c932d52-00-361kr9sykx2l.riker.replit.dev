import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Mail } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { PhoneVerifyPanel } from "@/components/auth/phone-verify-panel";

export const metadata: Metadata = {
  title: "Verify sign-in",
  description: "Complete email or phone verification to access your Maths Mania account.",
};

type Props = {
  searchParams: Promise<{ phone?: string; method?: string }>;
};

export default async function AuthVerifyPage({ searchParams }: Props) {
  const { phone, method } = await searchParams;

  if (method === "phone" && phone) {
    return (
      <>
        <Heading as="h1" size="h2">
          Enter OTP
        </Heading>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          We sent a 6-digit code to your phone.
        </p>
        <Suspense>
          <PhoneVerifyPanel phone={phone} className="mt-8" />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
        <Mail className="size-7" aria-hidden />
      </div>
      <Heading as="h1" size="h2" className="mt-6 text-center">
        Check your email
      </Heading>
      <p className="mt-3 text-center text-sm text-[var(--color-text-muted)]">
        Click the magic link we sent you. The link expires in about an hour.
        If you do not see it, check spam or try signing in again.
      </p>
      <div className="mt-8 flex flex-col gap-2">
        <Button variant="primary" size="lg" asChild className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
        <Button variant="ghost" size="md" asChild className="w-full">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </>
  );
}

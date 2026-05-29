import type { Metadata } from "next";
import { Heading } from "@/components/ui/heading";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { requireAuth } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Complete your profile",
  description: "Tell us what you are preparing for so we can personalise exams and resources.",
};

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function OnboardingPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const { profile } = await requireAuth();

  return (
    <>
      <Heading as="h1" size="h2">
        Almost there
      </Heading>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        This helps us show the right live mocks and study paths. Takes under a
        minute.
      </p>
      <OnboardingForm
        next={next ?? "/dashboard"}
        defaultFullName={profile.full_name === "Student" ? "" : profile.full_name}
        defaultPhone={profile.phone}
      />
    </>
  );
}

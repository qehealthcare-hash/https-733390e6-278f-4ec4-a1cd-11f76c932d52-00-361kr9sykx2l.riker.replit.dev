import type { Metadata } from "next";
import Link from "next/link";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guard";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function DashboardProfilePage() {
  const { profile, user } = await requireAuth({ requireOnboarded: true });

  return (
    <>
      <Heading as="h1" size="h2">
        Profile
      </Heading>
      <dl className="mt-8 space-y-4 text-sm">
        <div>
          <dt className="text-[var(--color-text-faint)]">Name</dt>
          <dd className="font-medium text-[var(--color-text)]">{profile.full_name}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-faint)]">Email</dt>
          <dd className="font-medium text-[var(--color-text)]">{user.email}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-faint)]">Preparing for</dt>
          <dd className="font-medium text-[var(--color-text)]">
            {profile.class_or_target ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-faint)]">City / State</dt>
          <dd className="font-medium text-[var(--color-text)]">
            {[profile.city, profile.state].filter(Boolean).join(", ") || "—"}
          </dd>
        </div>
      </dl>
      <Button variant="outline" size="md" className="mt-8" asChild>
        <Link href="/onboarding">Edit profile</Link>
      </Button>
    </>
  );
}

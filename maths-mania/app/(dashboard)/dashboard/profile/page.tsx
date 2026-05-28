import type { Metadata } from "next";
import { Heading } from "@/components/ui/heading";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { requireAuth } from "@/lib/auth/guard";

export const metadata: Metadata = {
  title: "Profile",
};

export const dynamic = "force-dynamic";

export default async function DashboardProfilePage() {
  const { profile, user } = await requireAuth({ requireOnboarded: true });

  return (
    <>
      <Heading as="h1" size="h2">
        Profile
      </Heading>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Signed in as {user.email}
      </p>
      <ProfileForm profile={profile} />
    </>
  );
}

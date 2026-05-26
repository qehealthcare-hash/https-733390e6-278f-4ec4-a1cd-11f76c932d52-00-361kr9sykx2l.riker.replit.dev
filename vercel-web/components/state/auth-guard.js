"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { hasPermission } from "@/lib/permissions";

export function AuthGuard({ children, permission }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(
    function () {
      if (!auth.loading && !auth.session) {
        router.replace("/login");
        return;
      }
      if (!auth.loading && auth.session && !auth.profile) {
        router.replace("/login");
        return;
      }
      if (
        !auth.loading &&
        auth.session &&
        auth.profile &&
        permission &&
        !hasPermission(auth.profile?.role, permission, auth.profile?.permissions)
      ) {
        router.replace("/dashboard");
      }
    },
    [auth.loading, auth.profile, auth.session, permission, router]
  );

  if (auth.loading) {
    return (
      <div className="login-wrap" role="status" aria-live="polite">
        <div className="panel login-card">
          <span className="sr-only">Loading CRM…</span>
          <span aria-hidden="true">Loading CRM…</span>
        </div>
      </div>
    );
  }

  if (!auth.session) return null;
  if (auth.session && !auth.profile) return null;

  if (
    permission &&
    auth.profile &&
    !hasPermission(auth.profile?.role, permission, auth.profile?.permissions)
  ) {
    return null;
  }

  return children;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { hasPermission } from "@/lib/permissions";

export function AuthGuard({ children, permission }) {
  const auth = useAuth();
  const router = useRouter();

  const stillResolving = auth.loading || (auth.session && auth.profileLoading);

  useEffect(
    function () {
      if (stillResolving) return;

      if (!auth.session) {
        router.replace("/login");
        return;
      }

      if (
        permission &&
        auth.profile &&
        !hasPermission(auth.profile?.role, permission)
      ) {
        router.replace("/dashboard");
      }
    },
    [stillResolving, auth.profile, auth.session, permission, router]
  );

  if (stillResolving) {
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

  if (auth.session && !auth.profile) {
    return (
      <div className="login-wrap" role="alert">
        <div className="panel login-card stack" style={{ textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Profile lookup failed</h2>
          <div className="mini-muted">
            {auth.profileError || "We couldn’t load your CRM profile. Please sign in again."}
          </div>
          <button
            className="button primary"
            type="button"
            onClick={function () {
              auth.signOut().finally(function () {
                router.replace("/login");
              });
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (
    permission &&
    auth.profile &&
    !hasPermission(auth.profile?.role, permission)
  ) {
    return null;
  }

  return children;
}

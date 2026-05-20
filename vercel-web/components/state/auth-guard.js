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
      } else if (!auth.loading && auth.session && auth.profile && permission && !hasPermission(auth.profile?.role, permission)) {
        router.replace("/dashboard");
      }
    },
    [auth.loading, auth.profile, auth.session, permission, router]
  );

  if (auth.loading) {
    return <div className="login-wrap"><div className="panel login-card">Loading CRM...</div></div>;
  }

  if (!auth.session) return null;
  if (permission && auth.profile && !hasPermission(auth.profile?.role, permission)) return null;

  return children;
}

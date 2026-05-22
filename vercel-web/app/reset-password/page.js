"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";

export default function ResetPasswordPage() {
  var auth = useAuth();
  var router = useRouter();

  useEffect(
    function () {
      if (!auth.loading) {
        router.replace(auth.session ? "/dashboard" : "/login");
      }
    },
    [auth.loading, auth.session, router]
  );

  return (
    <div className="login-wrap">
      <div className="panel login-card">Redirecting…</div>
    </div>
  );
}

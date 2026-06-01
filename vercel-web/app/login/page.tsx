"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { appConfig } from "@/lib/config";
import { useAuth } from "@/components/providers/auth-provider";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useToast } from "@/components/ui/toast";

/** Minimal auth context shape for the login screen (provider is still JS). */
type LoginAuth = {
  loading: boolean;
  session: { access_token?: string } | null;
  profile: Record<string, unknown> | null;
  profileLoading: boolean;
  profileError: string;
  signIn: (email: string, password: string) => Promise<void>;
};

export default function LoginPage() {
  const auth = useAuth() as unknown as LoginAuth;
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState("");
  const setError = useCallback(
    function (msg: string) {
      const text = String(msg || "");
      setErrorState(text);
      if (text) toast.error(text);
    },
    [toast]
  );

  useEffect(
    function () {
      if (auth.loading) return;
      if (!auth.session) return;
      if (auth.profileLoading) return;
      if (auth.profile) {
        router.replace("/dashboard");
      }
    },
    [auth.loading, auth.session, auth.profile, auth.profileLoading, router]
  );

  useEffect(
    function () {
      if (auth.profileError) {
        setError(auth.profileError);
      }
    },
    [auth.profileError, setError]
  );

  useEffect(
    function () {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("reset") === "1") {
        toast.success("Password updated. Sign in with your new password.");
      }
    },
    [toast]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.signIn(email.trim(), password);
    } catch (signInError: unknown) {
      const message =
        signInError instanceof Error ? signInError.message : "Sign-in failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading || (auth.session && auth.profileLoading)) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">Loading…</div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="panel login-card stack">
        <div style={{ textAlign: "center" }}>
          <BrandLogo
            src={appConfig.companyLogo}
            alt={appConfig.companyName}
            className="auth-logo"
            priority
          />
          <h1 style={{ margin: "12px 0 4px" }}>{appConfig.appName}</h1>
          <div className="mini-muted">Sign in with your CRM email (Supabase Auth)</div>
        </div>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-email-1">Email</label>
            <input
              id="login-email-1"
              type="email"
              autoComplete="username"
              value={email}
              onChange={function (event) {
                setEmail(event.target.value);
              }}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-password-2">Password</label>
            <input
              id="login-password-2"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={function (event) {
                setPassword(event.target.value);
              }}
              required
            />
          </div>
          {error ? (
            <div className="error-text" role="alert" aria-live="assertive">
              {error}
            </div>
          ) : null}
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="mini-muted" style={{ textAlign: "center" }}>
          Need the full legacy UI?{" "}
          <a href="/legacy" style={{ textDecoration: "underline" }}>
            Open Classic CRM
          </a>
        </div>
      </div>
    </div>
  );
}

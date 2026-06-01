"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { appConfig } from "@/lib/config";
import { useAuth } from "@/components/providers/auth-provider";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useToast } from "@/components/ui/toast";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState("");
  const setError = useCallback(
    function (msg) {
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

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.signIn(email.trim(), password);
    } catch (signInError) {
      setError(signInError.message || "Sign-in failed");
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
          <BrandLogo src={appConfig.companyLogo} alt={appConfig.companyName} className="auth-logo" priority />
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

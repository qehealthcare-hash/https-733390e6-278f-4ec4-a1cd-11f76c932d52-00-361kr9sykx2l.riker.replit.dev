"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { appConfig } from "@/lib/config";
import { useAuth } from "@/components/providers/auth-provider";

export default function LoginPage() {
  var auth = useAuth();
  var router = useRouter();
  var [email, setEmail] = useState("");
  var [password, setPassword] = useState("");
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState("");

  useEffect(
    function () {
      if (!auth.loading && auth.session) {
        router.replace("/dashboard");
      }
    },
    [auth.loading, auth.session, router]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.signIn(email.trim(), password);
      router.replace("/dashboard");
    } catch (signInError) {
      setError(signInError.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading) {
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
          <img src={appConfig.companyLogo} alt="" className="auth-logo" />
          <h1 style={{ margin: "12px 0 4px" }}>{appConfig.appName}</h1>
          <div className="mini-muted">Sign in with your CRM email (Supabase Auth)</div>
        </div>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
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
            <label>Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={function (event) {
                setPassword(event.target.value);
              }}
              required
            />
          </div>
          {error ? <div className="error-text">{error}</div> : null}
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

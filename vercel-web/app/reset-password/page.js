"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";

export default function ResetPasswordPage() {
  var auth = useAuth();
  var router = useRouter();
  var [password, setPassword] = useState("");
  var [confirm, setConfirm] = useState("");
  var [error, setError] = useState("");
  var [busy, setBusy] = useState(false);
  var [recoveryReady, setRecoveryReady] = useState(false);

  useEffect(
    function () {
      if (auth.loading) return;
      if (!auth.session) {
        router.replace("/login");
        return;
      }
      if (auth.syncLabel === "Recovery mode" || recoveryReady) {
        setRecoveryReady(true);
        return;
      }
      router.replace("/dashboard");
    },
    [auth.loading, auth.session, auth.syncLabel, recoveryReady, router]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      var result = await auth.supabase.auth.updateUser({ password: password });
      if (result.error) throw result.error;
      await auth.signOut();
      router.replace("/login?reset=1");
    } catch (submitError) {
      setError(submitError.message || "Unable to update password.");
    } finally {
      setBusy(false);
    }
  }

  if (auth.loading || !recoveryReady) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">Loading…</div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="panel login-card">
        <h1>Set a new password</h1>
        <p className="mini-muted">Choose a strong password for your CRM account.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="reset-password-new-password-1">
            New password
            <input id="reset-password-new-password-1"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={function (event) {
                setPassword(event.target.value);
              }}
              required
              minLength={8}
            />
          </label>
          <label htmlFor="reset-password-confirm-password-2">
            Confirm password
            <input id="reset-password-confirm-password-2"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={function (event) {
                setConfirm(event.target.value);
              }}
              required
              minLength={8}
            />
          </label>
          {error ? (
            <div className="error-text" role="alert">
              {error}
            </div>
          ) : null}
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}

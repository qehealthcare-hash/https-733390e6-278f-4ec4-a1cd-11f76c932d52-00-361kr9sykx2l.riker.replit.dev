"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";

type ResetAuth = {
  loading: boolean;
  session: { access_token?: string } | null;
  syncLabel: string;
  supabase: {
    auth: {
      updateUser: (args: {
        password: string;
      }) => Promise<{ error: { message?: string } | null }>;
    };
  };
  signOut: () => Promise<void>;
};

export default function ResetPasswordPage() {
  const auth = useAuth() as unknown as ResetAuth;
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setErrorState] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      const result = await auth.supabase.auth.updateUser({ password });
      if (result.error) throw result.error;
      toast.success("Password updated. Sign in with your new password.");
      await auth.signOut();
      router.replace("/login?reset=1");
    } catch (submitError: unknown) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Unable to update password.";
      setError(message);
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
            <input
              id="reset-password-new-password-1"
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
            <input
              id="reset-password-confirm-password-2"
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
            <div className="error-text" role="alert" aria-live="assertive">
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

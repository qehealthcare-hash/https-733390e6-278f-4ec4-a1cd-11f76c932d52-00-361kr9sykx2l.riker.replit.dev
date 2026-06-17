"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useBusyGuard } from "@/hooks/use-busy-guard";
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

type LoginError = Error & {
  code?: string;
  details?: { retry_after_seconds?: number } | null;
  status?: number;
};

export default function LoginPage() {
  const auth = useAuth() as unknown as LoginAuth;
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, tryBegin, end } = useBusyGuard();
  const [error, setErrorState] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [dbHealthy, setDbHealthy] = useState<boolean | null>(null);
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

  useEffect(
    function () {
      if (!cooldownUntil) {
        setCooldownRemaining(0);
        return;
      }
      function tick() {
        const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        setCooldownRemaining(remaining);
        if (remaining <= 0) {
          setCooldownUntil(0);
        }
      }
      tick();
      const timer = window.setInterval(tick, 1000);
      return function cleanup() {
        window.clearInterval(timer);
      };
    },
    [cooldownUntil]
  );

  useEffect(function () {
    let cancelled = false;
    async function pollHealth() {
      try {
        const res = await fetch("/api/v1/health", { cache: "no-store" });
        const body = (await res.json()) as {
          data?: { deps?: { supabase?: { ok?: boolean } } };
        };
        if (!cancelled) {
          setDbHealthy(body?.data?.deps?.supabase?.ok === true);
        }
      } catch {
        if (!cancelled) setDbHealthy(false);
      }
    }
    void pollHealth();
    const timer = window.setInterval(pollHealth, 30_000);
    return function cleanup() {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cooldownRemaining > 0) {
      setError("Too many login attempts. Please wait " + cooldownRemaining + " seconds.");
      return;
    }
    if (!tryBegin()) return;
    setError("");
    try {
      await auth.signIn(email.trim(), password);
    } catch (signInError: unknown) {
      const richError = signInError as LoginError;
      if (
        richError?.status === 429 ||
        richError?.code === "rate_limited" ||
        /too many requests/i.test(String(richError?.message || ""))
      ) {
        const retryAfter = Number(richError?.details?.retry_after_seconds || 60);
        setCooldownUntil(Date.now() + Math.max(10, retryAfter) * 1000);
        setError("Too many login attempts. Please wait " + Math.max(10, retryAfter) + " seconds and try once.");
        return;
      }
      if (
        richError?.status === 503 ||
        richError?.status === 502 ||
        richError?.code === "upstream_error" ||
        /temporarily unavailable|timed out|too long to respond/i.test(String(richError?.message || ""))
      ) {
        setError(
          richError?.message ||
            "Sign-in service is temporarily unavailable. Wait a minute and try again."
        );
        return;
      }
      const message =
        signInError instanceof Error ? signInError.message : "Sign-in failed";
      setError(message);
    } finally {
      end();
    }
  }

  if (auth.loading || (auth.session && auth.profileLoading)) {
    return (
      <div className="login-wrap">
        <div className="panel login-card" role="status" aria-live="polite">
          Loading…
        </div>
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
          <div className="mini-muted">Sign in with your CRM username or email</div>
        </div>
        {dbHealthy === false ? (
          <div
            className="error-text"
            role="status"
            style={{ background: "var(--surface-muted, #fff7ed)", padding: "10px 12px", borderRadius: 8 }}
          >
            Database is under heavy load right now. Close other CRM tabs, wait 2–3 minutes,
            then try again. Sign-in will work once the status below turns green.
          </div>
        ) : null}
        {dbHealthy !== null ? (
          <div className="mini-muted" role="status">
            Database status:{" "}
            <strong style={{ color: dbHealthy ? "var(--success, #15803d)" : "var(--danger, #b91c1c)" }}>
              {dbHealthy ? "ready" : "busy — retry shortly"}
            </strong>
          </div>
        ) : null}
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-email-1">Username or email</label>
            <input
              id="login-email-1"
              type="text"
              autoComplete="username"
              spellCheck={false}
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
          <button className="button primary" type="submit" disabled={busy || cooldownRemaining > 0}>
            {busy
              ? "Signing in…"
              : cooldownRemaining > 0
                ? "Wait " + cooldownRemaining + "s"
                : "Sign in"}
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

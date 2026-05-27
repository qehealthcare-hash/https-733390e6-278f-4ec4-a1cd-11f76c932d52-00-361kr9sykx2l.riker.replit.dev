"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Mail, Phone, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/auth/otp-input";
import { cn } from "@/lib/utils";

type Tab = "email" | "phone" | "google";

type LoginFormProps = {
  mode?: "login" | "signup";
  className?: string;
};

export function LoginForm({ mode = "login", className }: LoginFormProps) {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const errorParam = searchParams.get("error");

  const [tab, setTab] = React.useState<Tab>("email");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [phoneSent, setPhoneSent] = React.useState(false);
  const [storedPhone, setStoredPhone] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(() => {
    if (errorParam === "auth") {
      return "Sign-in link expired or invalid. Please try again.";
    }
    if (errorParam === "supabase") {
      return "Authentication is not configured on this server.";
    }
    return null;
  });

  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  async function handleEmailMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }

    setStatus("loading");
    setMessage(null);

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
        shouldCreateUser: true,
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("sent");
    setMessage("Check your email for a sign-in link. It expires in about an hour.");
  }

  async function handleGoogle() {
    const supabase = createClient();
    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }

    setStatus("loading");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);

    const res = await fetch("/api/auth/phone/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      phone?: string;
    };

    if (!res.ok || !data.ok) {
      setStatus("error");
      setMessage(data.message ?? "Could not send OTP.");
      return;
    }

    setStoredPhone(data.phone ?? phone);
    setPhoneSent(true);
    setStatus("idle");
    setMessage(data.message ?? "OTP sent.");
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);

    const res = await fetch("/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: storedPhone || phone, otp }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      actionLink?: string;
    };

    if (!res.ok || !data.ok || !data.actionLink) {
      setStatus("error");
      setMessage(data.message ?? "Verification failed.");
      return;
    }

    window.location.href = data.actionLink;
  }

  if (!supabaseConfigured) {
    return (
      <div className={cn("rounded-[var(--radius-xl)] border border-amber-200 bg-amber-50 p-6 text-sm dark:border-amber-900 dark:bg-amber-950/40", className)}>
        <p className="font-semibold text-[var(--color-text)]">
          Auth not configured
        </p>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Add <code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code className="text-xs">.env.local</code>, then run{" "}
          <code className="text-xs">supabase db reset</code>.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-1">
        {(
          [
            { id: "email" as const, label: "Email", icon: Mail },
            { id: "phone" as const, label: "Phone", icon: Phone },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setMessage(null);
              setStatus("idle");
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition",
              tab === id
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)]",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {message && (
        <p
          className={cn(
            "rounded-[var(--radius-md)] px-4 py-3 text-sm",
            status === "error"
              ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
              : "bg-[var(--color-primary-50)] text-[var(--color-primary-800)] dark:bg-[var(--color-primary-900)]/30 dark:text-[var(--color-primary-100)]",
          )}
          role="status"
        >
          {message}
        </p>
      )}

      {tab === "email" && (
        <form onSubmit={handleEmailMagicLink} className="space-y-4">
          <div>
            <label
              htmlFor="auth-email"
              className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
            >
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={status === "loading" || status === "sent"}
          >
            {status === "loading" && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            {mode === "signup" ? "Create account with email" : "Send magic link"}
          </Button>
        </form>
      )}

      {tab === "phone" && !phoneSent && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <label
              htmlFor="auth-phone"
              className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
            >
              Mobile number
            </label>
            <input
              id="auth-phone"
              type="tel"
              name="phone"
              required
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98XXXXXXXX"
              className="mt-1.5 h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-sm"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={status === "loading"}
          >
            {status === "loading" && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            Send OTP
          </Button>
          <p className="text-xs text-[var(--color-text-faint)]">
            SMS via MSG91 when configured. Dev mode logs OTP to the server console;
            use <strong>000000</strong> if MSG91 is off.
          </p>
        </form>
      )}

      {tab === "phone" && phoneSent && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <OtpInput value={otp} onChange={setOtp} disabled={status === "loading"} />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={status === "loading" || otp.length !== 6}
          >
            {status === "loading" && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            Verify & sign in
          </Button>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--color-primary-600)]"
            onClick={() => {
              setPhoneSent(false);
              setOtp("");
            }}
          >
            Change number
          </button>
        </form>
      )}

      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <div className="w-full border-t border-[var(--color-border)]" />
        </div>
        <p className="relative mx-auto w-fit bg-[var(--color-surface)] px-3 text-xs text-[var(--color-text-faint)]">
          or
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={status === "loading"}
        onClick={handleGoogle}
      >
        Continue with Google
      </Button>

      <p className="text-center text-sm text-[var(--color-text-muted)]">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-[var(--color-primary-600)]">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-semibold text-[var(--color-primary-600)]">
              Create account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UserMenuProps = {
  className?: string;
};

type SessionUser = {
  email?: string;
  displayName: string;
};

/**
 * Navbar account menu — sign in link when logged out, avatar dropdown when logged in.
 */
export function UserMenu({ className }: UserMenuProps) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [loading, setLoading] = React.useState(() => Boolean(supabase));
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    let cancelled = false;

    async function load() {
      const {
        data: { user: authUser },
      } = await client.auth.getUser();
      if (cancelled) return;

      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: profile } = await client
        .from("profiles")
        .select("display_name, full_name")
        .eq("id", authUser.id)
        .maybeSingle();

      if (cancelled) return;

      setUser({
        email: authUser.email ?? undefined,
        displayName:
          profile?.display_name ??
          profile?.full_name ??
          authUser.email?.split("@")[0] ??
          "Account",
      });
      setLoading(false);
    }

    load();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(() => {
      setLoading(true);
      load();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  React.useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  async function signOut() {
    const supabase = createClient();
    if (supabase) await supabase.auth.signOut();
    setOpen(false);
    router.refresh();
    router.push("/");
  }

  if (!supabase) {
    return (
      <Button
        asChild
        variant="outline"
        size="sm"
        className={cn("hidden md:inline-flex", className)}
      >
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }

  if (loading) {
    return (
      <span
        className={cn("hidden size-9 md:inline-block", className)}
        aria-hidden
      />
    );
  }

  if (!user) {
    return (
      <Button
        asChild
        variant="outline"
        size="sm"
        className={cn("hidden md:inline-flex", className)}
      >
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }

  const initials = user.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className={cn("relative hidden md:block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--color-primary-100)] text-sm font-bold text-[var(--color-primary-700)] ring-2 ring-transparent hover:ring-[var(--color-primary-300)] dark:bg-[var(--color-primary-900)]/50 dark:text-[var(--color-primary-100)]"
        aria-label="Account menu"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] py-2 shadow-lg"
        >
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <p className="font-semibold text-[var(--color-text)]">
              {user.displayName}
            </p>
            {user.email && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {user.email}
              </p>
            )}
          </div>
          <Link
            href="/dashboard"
            role="menuitem"
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => setOpen(false)}
          >
            <LayoutDashboard className="size-4" aria-hidden />
            Dashboard
          </Link>
          <Link
            href="/dashboard/profile"
            role="menuitem"
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
            onClick={() => setOpen(false)}
          >
            <User className="size-4" aria-hidden />
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
            onClick={signOut}
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

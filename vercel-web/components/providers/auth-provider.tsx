"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { flushOfflineQueue } from "@/lib/offline-queue";
import type { ApiSession } from "@/lib/clients/types";
import { authClient } from "@/lib/clients";
import { hasRefreshSessionHint } from "@/lib/auth/sessionHint";

export type AuthSession = ApiSession;

export type AuthProfile = {
  role?: string;
  full_name?: string;
  email?: string;
  [key: string]: unknown;
} | null;

export type AuthContextValue = {
  supabase: ReturnType<typeof getBrowserSupabase>;
  session: AuthSession;
  profile: AuthProfile;
  loading: boolean;
  profileLoading: boolean;
  profileError: string;
  syncLabel: string;
  signIn: (
    identifier: string,
    password: string
  ) => Promise<{ session: AuthSession; user: unknown }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(function () {
    return getBrowserSupabase();
  }, []);
  const [session, setSession] = useState<AuthSession>(null);
  const [profile, setProfile] = useState<AuthProfile>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [syncLabel, setSyncLabel] = useState("Connecting...");
  const sessionRef = useRef<AuthSession>(null);
  const refreshInFlightRef = useRef<Promise<AuthSession> | null>(null);
  useEffect(function () {
    sessionRef.current = session;
  }, [session]);

  useEffect(function () {
    let mounted = true;

    async function loadProfile(nextSession: AuthSession) {
      if (!nextSession?.access_token) return;
      if (mounted) {
        setProfileLoading(true);
        setProfileError("");
      }
      try {
        const me = await authClient.me(nextSession);
        if (mounted) {
          setProfile((me as AuthProfile) || null);
          setProfileError("");
          setSyncLabel("Connected");
        }
      } catch (error: unknown) {
        if (mounted) {
          setProfile(null);
          setProfileError(
            error instanceof Error ? error.message : "Profile lookup failed"
          );
          setSyncLabel("Connected with warnings");
        }
      } finally {
        if (mounted) setProfileLoading(false);
      }
    }

    function runBackgroundSync(nextSession: AuthSession) {
      if (!nextSession?.access_token) return;
      Promise.resolve(flushOfflineQueue(nextSession))
        .then(function () {
          if (mounted) setSyncLabel("Connected");
        })
        .catch(function () {
          if (mounted) setSyncLabel("Connected with warnings");
        });
    }

    async function refreshSessionFromCookie(): Promise<AuthSession> {
      if (refreshInFlightRef.current) {
        return refreshInFlightRef.current;
      }
      const pending = (async function () {
        try {
          const tokens = await authClient.refresh();
          if (!tokens.access_token) return null;
          return { access_token: tokens.access_token };
        } catch {
          return null;
        } finally {
          refreshInFlightRef.current = null;
        }
      })();
      refreshInFlightRef.current = pending;
      return pending;
    }

    async function bootstrap() {
      try {
        let activeSession: AuthSession = null;
        const result = await supabase.auth.getSession();
        activeSession = result.data.session || null;
        if (!activeSession?.access_token && hasRefreshSessionHint()) {
          activeSession = await refreshSessionFromCookie();
        }
        if (!mounted) return;
        setSession(activeSession);
        setLoading(false);
        if (activeSession?.access_token) {
          loadProfile(activeSession);
          runBackgroundSync(activeSession);
        } else {
          setSyncLabel("Signed out");
        }
      } catch {
        if (mounted) {
          setSession(null);
          setProfile(null);
          setSyncLabel("Connected with warnings");
          setLoading(false);
        }
      }
    }

    bootstrap();

    const subscription = supabase.auth.onAuthStateChange(async function (
      event: string,
      nextSession: AuthSession
    ) {
      if (event === "TOKEN_REFRESHED" && !nextSession?.access_token && hasRefreshSessionHint()) {
        const recovered = await refreshSessionFromCookie();
        if (recovered?.access_token) {
          setSession(recovered);
          loadProfile(recovered);
          runBackgroundSync(recovered);
          setLoading(false);
          return;
        }
      }
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") {
        setProfile(null);
        setSyncLabel("Recovery mode");
        setLoading(false);
        return;
      }
      setLoading(false);
      if (nextSession?.access_token) {
        loadProfile(nextSession);
        runBackgroundSync(nextSession);
      } else {
        setProfile(null);
        setSyncLabel("Signed out");
      }
    });

    function handleOnline() {
      const current = sessionRef.current;
      if (current?.access_token) runBackgroundSync(current);
    }
    function handleVisibility() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        handleOnline();
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("visibilitychange", handleVisibility);
    }

    return function cleanup() {
      mounted = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("visibilitychange", handleVisibility);
      }
      subscription.data.subscription.unsubscribe();
    };
  }, [supabase]);

  const value: AuthContextValue = {
    supabase,
    session,
    profile,
    loading,
    profileLoading,
    profileError,
    syncLabel,
    async signIn(identifier, password) {
      let tokens;
      try {
        tokens = await authClient.login(identifier, password);
      } catch (err: unknown) {
        const apiErr = err as Error & { code?: string; details?: unknown; status?: number };
        const wrapped = new Error(apiErr.message || "Invalid username or password") as Error & {
          code?: string;
          details?: unknown;
          status?: number;
        };
        if (apiErr.code) wrapped.code = apiErr.code;
        if (apiErr.details !== undefined) wrapped.details = apiErr.details;
        if (apiErr.status) wrapped.status = apiErr.status;
        throw wrapped;
      }
      if (!tokens.access_token) {
        throw new Error("Login succeeded but no access token was returned");
      }
      const nextSession = { access_token: tokens.access_token };
      setSession(nextSession);
      setLoading(false);
      setProfileLoading(true);
      setProfileError("");
      try {
        const me = await authClient.me(nextSession);
        setProfile((me as AuthProfile) || null);
        setSyncLabel("Connected");
      } catch (error: unknown) {
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : "Profile lookup failed");
        setSyncLabel("Connected with warnings");
      } finally {
        setProfileLoading(false);
      }
      Promise.resolve(flushOfflineQueue(nextSession)).catch(function () {
        setSyncLabel("Connected with warnings");
      });
      return { session: nextSession, user: tokens.user || null };
    },
    async signOut() {
      const currentToken = sessionRef.current?.access_token;
      if (currentToken) {
        try {
          await authClient.logout({ access_token: currentToken }, "global");
        } catch {
          /* server-side revoke is best-effort */
        }
      }
      try {
        localStorage.removeItem("hhcrm-offline-queue");
      } catch {
        /* ignore */
      }
      try {
        await supabase.auth.signOut();
      } catch {
        /* browser Supabase session may be absent because CRM uses HttpOnly refresh cookie */
      }
      setProfile(null);
      setProfileError("");
      setSession(null);
      setSyncLabel("Signed out");
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

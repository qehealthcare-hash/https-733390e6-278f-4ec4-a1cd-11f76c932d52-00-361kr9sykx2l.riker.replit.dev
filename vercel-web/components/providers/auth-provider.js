"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { flushOfflineQueue, request } from "@/lib/api-client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const supabase = useMemo(function () {
    return getBrowserSupabase();
  }, []);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [syncLabel, setSyncLabel] = useState("Connecting...");
  // Latest session for the offline-queue listeners (closures need the
  // newest token, not the one in scope when the listener registered).
  const sessionRef = useRef(null);
  useEffect(function () {
    sessionRef.current = session;
  }, [session]);

  useEffect(function () {
    let mounted = true;

    async function loadProfile(nextSession) {
      if (!nextSession?.access_token) return;
      if (mounted) {
        setProfileLoading(true);
        setProfileError("");
      }
      try {
        const me = await request("/auth/me", null, nextSession);
        if (mounted) {
          setProfile(me);
          setProfileError("");
          setSyncLabel("Connected");
        }
      } catch (error) {
        if (mounted) {
          setProfile(null);
          setProfileError(error?.message || "Profile lookup failed");
          setSyncLabel("Connected with warnings");
        }
      } finally {
        if (mounted) setProfileLoading(false);
      }
    }

    function runBackgroundSync(nextSession) {
      if (!nextSession?.access_token) return;
      Promise.resolve(flushOfflineQueue(nextSession))
        .then(function () {
          if (mounted) setSyncLabel("Connected");
        })
        .catch(function () {
          if (mounted) setSyncLabel("Connected with warnings");
        });
    }

    async function bootstrap() {
      try {
        const result = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(result.data.session || null);
        setLoading(false);
        if (result.data.session?.access_token) {
          loadProfile(result.data.session);
          runBackgroundSync(result.data.session);
        } else {
          setSyncLabel("Signed out");
        }
      } catch (error) {
        if (mounted) {
          setSession(null);
          setProfile(null);
          setSyncLabel("Connected with warnings");
          setLoading(false);
        }
      }
    }

    bootstrap();

    const subscription = supabase.auth.onAuthStateChange(async function (event, nextSession) {
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

    // P1-3: replay the offline queue when the tab comes back online or
    // visibility flips to "visible". Holding queued writes until the next
    // explicit auth event (login / token refresh) meant a user who simply
    // alt-tabbed away during a Wi-Fi blip waited until the next login to
    // get their saves through. These listeners reuse the same session-aware
    // flush path so an expired/refreshed session is handled centrally.
    function handleOnline() {
      var current = sessionRef.current;
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

  const value = {
    supabase,
    session,
    profile,
    loading,
    profileLoading,
    profileError,
    syncLabel,
    async signIn(identifier, password) {
      // P1-38: route the password sign-in through the rate-limited
      // /api/v1/auth/login proxy. The browser no longer hits GoTrue
      // directly, so brute-force attempts are bounded by the persistent
      // Upstash limiter (5 attempts / 60 s / IP) regardless of which
      // Vercel region the request lands on.
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password })
      });
      const json = await res.json().catch(function () { return {}; });
      if (!res.ok || json?.success === false) {
        const err = new Error(json?.error || "Invalid username or password");
        err.status = res.status;
        throw err;
      }
      const tokens = json?.data || json;
      // Hand the freshly minted tokens to supabase-js so onAuthStateChange
      // fires for the rest of the app exactly as it did before.
      const setResult = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token
      });
      if (setResult.error) throw setResult.error;
      return { session: setResult.data.session, user: setResult.data.user };
    },
    async signOut() {
      try {
        localStorage.removeItem("hhcrm-offline-queue");
      } catch (_err) {
        /* ignore */
      }
      await supabase.auth.signOut();
      setProfile(null);
      setProfileError("");
      setSession(null);
      setSyncLabel("Signed out");
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

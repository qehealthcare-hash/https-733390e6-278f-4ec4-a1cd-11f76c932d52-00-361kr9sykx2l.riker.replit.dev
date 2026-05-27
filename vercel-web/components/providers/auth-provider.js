"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

    return function cleanup() {
      mounted = false;
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
    async signIn(email, password) {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      return result.data;
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

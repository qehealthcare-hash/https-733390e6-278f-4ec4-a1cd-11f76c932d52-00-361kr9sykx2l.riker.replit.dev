"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { appConfig } from "@/lib/config";

export default function ResetPasswordPage() {
  var auth = useAuth();
  var router = useRouter();
  var _useState = useState("");
  var password = _useState[0];
  var setPassword = _useState[1];
  var _useState2 = useState("");
  var confirmPassword = _useState2[0];
  var setConfirmPassword = _useState2[1];
  var _useState3 = useState("");
  var error = _useState3[0];
  var setError = _useState3[1];
  var _useState4 = useState("");
  var message = _useState4[0];
  var setMessage = _useState4[1];
  var _useState5 = useState(true);
  var loading = _useState5[0];
  var setLoading = _useState5[1];
  var _useState6 = useState(false);
  var saving = _useState6[0];
  var setSaving = _useState6[1];

  useEffect(function () {
    var mounted = true;

    async function bootstrap() {
      try {
        var hash = typeof window !== "undefined" ? window.location.hash || "" : "";
        if (hash.indexOf("access_token=") >= 0 && hash.indexOf("refresh_token=") >= 0) {
          var params = new URLSearchParams(hash.replace(/^#/, ""));
          var accessToken = params.get("access_token");
          var refreshToken = params.get("refresh_token");
          if (accessToken && refreshToken) {
            var sessionResult = await auth.supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });
            if (sessionResult.error) throw sessionResult.error;
          }
        }
        var result = await auth.supabase.auth.getSession();
        if (!mounted) return;
        if (result.data.session) {
          setMessage("Recovery session verified. Set a new password below.");
        } else {
          setError("Open this page from a valid recovery link.");
        }
      } catch (err) {
        if (mounted) setError(err.message || "Unable to verify recovery session.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    bootstrap();

    var listener = auth.supabase.auth.onAuthStateChange(function (event, nextSession) {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || nextSession) {
        setError("");
        setMessage("Recovery session verified. Set a new password below.");
        setLoading(false);
      }
    });

    return function cleanup() {
      mounted = false;
      listener.data.subscription.unsubscribe();
    };
  }, [auth.supabase]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      var current = await auth.supabase.auth.getSession();
      if (!current.data.session) {
        throw new Error("Recovery session missing. Reload the recovery link and try again.");
      }
      var result = await auth.supabase.auth.updateUser({ password: password });
      if (result.error) throw result.error;
      setMessage("Password updated successfully. Redirecting to login...");
      setTimeout(function () {
        router.replace("/login");
      }, 1200);
    } catch (err) {
      setError(err.message || "Unable to update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="panel login-card stack" onSubmit={handleSubmit}>
        <div>
          <img src={appConfig.companyLogo} alt={appConfig.companyName + " logo"} className="auth-logo" />
          <h1 style={{ marginBottom: 6 }}>{appConfig.companyName}</h1>
          <div className="mini-muted">{appConfig.companyTagline}</div>
        </div>
        <div>
          <strong>Reset Admin Password</strong>
          <div className="mini-muted">Use this page only from a recovery link.</div>
        </div>
        <div className="field">
          <label>New Password</label>
          <input type="password" value={password} onChange={function (event) { setPassword(event.target.value); }} disabled={loading || saving} />
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <input type="password" value={confirmPassword} onChange={function (event) { setConfirmPassword(event.target.value); }} disabled={loading || saving} />
        </div>
        {loading ? <div className="mini-muted">Checking recovery session...</div> : null}
        {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
        {message ? <div style={{ color: "var(--success)" }}>{message}</div> : null}
        <button className="button primary" type="submit" disabled={loading || saving}>
          {saving ? "Updating..." : "Update Password"}
        </button>
      </form>
    </div>
  );
}

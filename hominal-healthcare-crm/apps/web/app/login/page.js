"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { appConfig } from "@/lib/config";

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await auth.signIn(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoading(false);
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
        <div className="field">
          <label>Email</label>
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
        <button className="button primary" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

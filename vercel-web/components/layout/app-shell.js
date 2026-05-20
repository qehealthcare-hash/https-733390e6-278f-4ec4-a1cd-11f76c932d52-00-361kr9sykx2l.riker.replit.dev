"use client";

import { Sidebar } from "./sidebar";
import { useAuth } from "@/components/providers/auth-provider";

export function AppShell({ title, children }) {
  const auth = useAuth();

  return (
    <div className="crm-shell">
      <Sidebar />
      <main className="crm-main">
        <div className="topbar">
          <div>
            <h1 style={{ margin: 0 }}>{title}</h1>
            <div className="mini-muted">
              {auth.profile?.full_name || auth.profile?.email || "Loading user"}
            </div>
          </div>
          <div className="button-row">
            <div className="sync-pill">{auth.syncLabel}</div>
            <button className="button secondary" onClick={auth.signOut}>
              Sign out
            </button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

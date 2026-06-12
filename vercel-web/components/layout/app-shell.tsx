"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { useAuth } from "@/components/providers/auth-provider";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const auth = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  const closeNav = useCallback(function () {
    setNavOpen(false);
  }, []);

  useEffect(
    function () {
      if (!navOpen) return undefined;
      function onKey(event: KeyboardEvent) {
        if (event.key === "Escape") setNavOpen(false);
      }
      document.addEventListener("keydown", onKey);
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return function () {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = previousOverflow;
      };
    },
    [navOpen]
  );

  return (
    <div className={"crm-shell" + (navOpen ? " crm-shell-nav-open" : "")}>
      <Sidebar open={navOpen} onNavigate={closeNav} />
      {navOpen ? (
        <button
          type="button"
          className="crm-nav-backdrop"
          aria-label="Close navigation menu"
          onClick={closeNav}
        />
      ) : null}
      <main id="crm-main-content" className="crm-main" tabIndex={-1}>
        <div className="topbar">
          <div className="topbar-lead">
            <button
              type="button"
              className="crm-hamburger"
              aria-label="Open navigation menu"
              aria-expanded={navOpen ? "true" : "false"}
              aria-controls="crm-sidebar-nav"
              onClick={function () {
                setNavOpen(true);
              }}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <div>
              <h1 style={{ margin: 0 }}>{title}</h1>
              <div className="mini-muted">
                {auth?.profile?.full_name || auth?.profile?.email || "Loading user"}
              </div>
            </div>
          </div>
          <div className="button-row">
            <div className="sync-pill" aria-live="polite">
              {auth?.syncLabel ?? ""}
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={function () {
                auth?.signOut().then(function () {
                  window.location.href = "/login";
                });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

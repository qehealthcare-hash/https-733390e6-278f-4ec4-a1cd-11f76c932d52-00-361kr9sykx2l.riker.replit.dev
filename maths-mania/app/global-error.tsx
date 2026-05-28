"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Root error boundary — must define its own html/body (no layout chrome).
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#0f1419",
          color: "#e8eaed",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <p style={{ fontSize: "3rem", fontWeight: 700, color: "#f87171" }}>
            500
          </p>
          <h1 style={{ fontSize: "1.5rem", marginTop: "1rem" }}>
            Critical error
          </h1>
          <p style={{ marginTop: "1rem", lineHeight: 1.6, opacity: 0.85 }}>
            The app hit a fatal error. Reload the page — if you were in an exam,
            your autosaved answers should still be stored.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 1.5rem",
              borderRadius: "9999px",
              border: "none",
              background: "#6366f1",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}

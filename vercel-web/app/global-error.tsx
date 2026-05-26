"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(
    function () {
      Sentry.captureException(error);
    },
    [error]
  );

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1>Something went wrong</h1>
        <p style={{ color: "#64748b" }}>The error was reported to our monitoring system.</p>
        <button
          type="button"
          onClick={function () {
            reset();
          }}
          style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

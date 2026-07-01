"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Root render-crash boundary (replaces <html> entirely, so it owns the shell).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0d10",
          color: "#e6e8eb",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "1.5rem" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ opacity: 0.7, fontSize: "0.9rem" }}>
            The error has been logged. Live match data is safe — every score is
            stored as it happens.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #2e3440",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

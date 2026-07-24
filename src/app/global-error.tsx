"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary. This fires only when the root layout itself
 * fails, so it fully replaces `<html>`/`<body>` and cannot rely on the app's
 * providers, theme, fonts, or `globals.css` being mounted. Everything here is
 * therefore self-contained (inline styles + a small embedded stylesheet for
 * dark-mode support) and uses no app imports.
 *
 * As with the route-level boundary, we never render the error message or stack
 * to the user — a crash can carry connection or budget data (AGENTS.md §4).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Fatal application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <style>{`
          .ab-fatal {
            --bg: #ffffff;
            --fg: #171717;
            --muted: #737373;
            --accent: #171717;
            --accent-fg: #fafafa;
            --border: #e5e5e5;
          }
          @media (prefers-color-scheme: dark) {
            .ab-fatal {
              --bg: #0a0a0a;
              --fg: #fafafa;
              --muted: #a3a3a3;
              --accent: #fafafa;
              --accent-fg: #171717;
              --border: #262626;
            }
          }
        `}</style>
        <div
          role="alert"
          className="ab-fatal"
          style={{
            minHeight: "100vh",
            margin: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.5rem",
            padding: "2rem",
            textAlign: "center",
            background: "var(--bg)",
            color: "var(--fg)",
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          }}
        >
          <div style={{ maxWidth: "28rem" }}>
            <h1
              style={{
                fontSize: "1.125rem",
                fontWeight: 600,
                margin: "0 0 0.5rem",
              }}
            >
              Actual Bench hit a fatal error
            </h1>
            <p
              style={{
                fontSize: "0.875rem",
                color: "var(--muted)",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              The app failed to load. Try again, and if the problem persists,
              reload the page or reconnect from the start.
            </p>
            {error.digest ? (
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "var(--muted)",
                  marginTop: "0.75rem",
                }}
              >
                Reference: {error.digest}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "2.25rem",
              padding: "0 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              background: "var(--accent)",
              color: "var(--accent-fg)",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

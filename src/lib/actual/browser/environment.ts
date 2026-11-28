export function assertDirectBrowserApiEnvironment(): void {
  if (typeof window === "undefined") {
    throw new Error("Direct browser API transport can only run in the browser.");
  }

  // Browsers only isolate a secure context (HTTPS, or localhost), so on plain
  // http:// by IP address or hostname no header Bench sends can help. Saying
  // so points people at the fix instead of at headers that are already there.
  if (window.isSecureContext !== true) {
    throw new Error(
      "Direct Actual Server mode needs Actual Bench to be opened over HTTPS (or on localhost), " +
        "and this page is plain HTTP. Set ACTUAL_BENCH_HTTPS=true to have Bench serve HTTPS itself, " +
        "or put it behind an HTTPS reverse proxy."
    );
  }

  if (window.crossOriginIsolated !== true) {
    throw new Error(
      "Direct Actual Server mode requires cross-origin isolation (COOP/COEP). " +
        "Bench sends these headers itself, so a reverse proxy in front of it may be removing them. " +
        "Or use HTTP API Server mode."
    );
  }
}

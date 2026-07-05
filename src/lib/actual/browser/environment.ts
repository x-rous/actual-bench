export function assertDirectBrowserApiEnvironment(): void {
  if (typeof window === "undefined") {
    throw new Error("Direct browser API transport can only run in the browser.");
  }

  if (window.crossOriginIsolated !== true) {
    throw new Error(
      "Direct Actual Server mode requires cross-origin isolation (COOP/COEP). " +
        "Enable Direct mode headers for Actual Bench, or use HTTP API Server mode."
    );
  }
}

/** Browser-only, opt-in diagnostics. Flags contain no connection or budget data. */
export function runtimeDiagnosticEnabled(flag: string): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(flag) === "1"; }
  catch { return false; }
}

export function runtimeTiming(label: string): { step(name: string): void; end(): void } {
  const enabled = runtimeDiagnosticEnabled("ab:debug-timing");
  const started = Date.now();
  let last = started;
  const steps: string[] = [];
  return {
    step(name) {
      if (!enabled) return;
      const now = Date.now();
      steps.push(`${name} ${now - last} ms`);
      last = now;
    },
    end() {
      if (enabled) {
        try { console.info(`[actual-bench timing] ${label}: ${Date.now() - started} ms (${steps.join(", ")})`); }
        catch { /* Diagnostics must never change the operation's result. */ }
      }
    },
  };
}

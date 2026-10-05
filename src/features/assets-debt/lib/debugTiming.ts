/**
 * Opt-in timing for the loan Activity (set `localStorage["ab:debug-timing"] = "1"` in the browser).
 * Logs how long each step of a refresh or an apply took, to the browser console only. Never logs
 * amounts, ids or names; never sent anywhere.
 */
export function startTiming(label: string): { step: (name: string) => void; end: () => void } {
  let enabled = false;
  try {
    enabled = typeof localStorage !== "undefined" && localStorage.getItem("ab:debug-timing") === "1";
  } catch {
    enabled = false;
  }
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
      if (!enabled) return;
      console.info(`[actual-bench timing] ${label}: ${Date.now() - started} ms (${steps.join(", ")})`);
    },
  };
}

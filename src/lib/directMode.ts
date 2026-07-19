import { logger } from "@/lib/logger";

export const DIRECT_MODE_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

export function isDirectBrowserApiDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

type DirectModeEnv = {
  DIRECT_BROWSER_API?: string;
  /** @deprecated Use `DIRECT_BROWSER_API`. Honored for one release, then removed. */
  NEXT_PUBLIC_DIRECT_BROWSER_API?: string;
};

let warnedDeprecated = false;

/**
 * Direct Actual Server mode is enabled unless it is explicitly disabled.
 *
 * `DIRECT_BROWSER_API` is the single, canonical switch — a server-side runtime
 * variable read consistently by the Node middleware (isolation headers), the
 * connect UI, and the Actual-engine asset route. Set it to `0` / `false` /
 * `off` to disable Direct mode; no rebuild required on the prebuilt image.
 *
 * `NEXT_PUBLIC_DIRECT_BROWSER_API` is a deprecated alias kept working for one
 * release (it emits a warning). Either variable disabling the mode disables it.
 */
export function isDirectBrowserApiEnabled(
  env: DirectModeEnv = {
    DIRECT_BROWSER_API: process.env.DIRECT_BROWSER_API,
    NEXT_PUBLIC_DIRECT_BROWSER_API: process.env.NEXT_PUBLIC_DIRECT_BROWSER_API,
  }
): boolean {
  if (isDirectBrowserApiDisabled(env.DIRECT_BROWSER_API)) return false;

  // Deprecated alias: still honored, but warn once so operators migrate.
  if (env.NEXT_PUBLIC_DIRECT_BROWSER_API !== undefined) {
    if (!warnedDeprecated) {
      warnedDeprecated = true;
      logger.warn(
        "NEXT_PUBLIC_DIRECT_BROWSER_API is deprecated; use DIRECT_BROWSER_API instead. It will be removed in a future release."
      );
    }
    if (isDirectBrowserApiDisabled(env.NEXT_PUBLIC_DIRECT_BROWSER_API)) return false;
  }

  return true;
}

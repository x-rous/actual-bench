/**
 * The Actual Bench desktop app runs this server on the user's own computer
 * and says so through the environment (`desktop/src/main.cjs`):
 *
 *   * `ACTUAL_BENCH_DESKTOP=1`
 *   * `ACTUAL_BENCH_ACTUAL_DESKTOP_SERVER_URL`: the server the Actual desktop
 *     app on the same computer is set up with, read from Actual's settings
 *     (its built-in local server, default `http://localhost:5007`).
 *
 * Server-only: reads the environment.
 */

/** True when this server is running inside the desktop app. */
export function isDesktopApp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ACTUAL_BENCH_DESKTOP === "1";
}

/**
 * The Actual desktop app's server to suggest on the connect screen, or null
 * outside the desktop app. Only a plain http(s) origin and path come through:
 * no credentials, query or fragment.
 */
export function actualDesktopServerUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isDesktopApp(env)) return null;
  const raw = env.ACTUAL_BENCH_ACTUAL_DESKTOP_SERVER_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

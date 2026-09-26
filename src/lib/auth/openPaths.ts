/**
 * What can be reached without signing in (RD-096). Everything else, pages and
 * API alike, needs a session. `openPaths.test.ts` walks every API route and
 * fails if one outside this list is open, or one inside it no longer exists.
 */

/** Exact API paths that must answer before sign-in. */
export const OPEN_API_PATHS = [
  // Container health probe (Fly, Docker); answers a bare status word.
  "/api/health",
  // The sign-in page: is a password set yet, and is this browser signed in.
  "/api/connection-vault",
  // Sign in.
  "/api/connection-vault/unlock",
  // First run: set the password. The route refuses once one exists.
  "/api/connection-vault/passphrase",
] as const;

const OPEN_PAGES = new Set(["/login", "/.well-known/security.txt"]);

// The sign-in page's own scripts, styles, fonts and images.
const OPEN_ASSET_PREFIXES = ["/_next/"];
const OPEN_ASSETS = new Set(["/favicon.ico", "/icon.png", "/logo.png"]);

const OPEN_API = new Set<string>(OPEN_API_PATHS);

export function isOpenPath(pathname: string): boolean {
  if (OPEN_API.has(pathname) || OPEN_PAGES.has(pathname) || OPEN_ASSETS.has(pathname)) return true;
  return OPEN_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Where to send someone after signing in. Only a page on this site: the value
 * is resolved the way a browser would (which, among other things, drops tabs
 * and newlines, so "/\t/evil.example" becomes "//evil.example") and kept only
 * when it stays on the same origin. Anything else, and the sign-in page
 * itself, falls back to the connect page, so the link can't bounce people
 * elsewhere.
 */
export function safeNextPath(next: string | null | undefined): string {
  const FALLBACK = "/connect";
  if (!next || !next.startsWith("/")) return FALLBACK;
  const base = "http://bench.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== base || url.pathname === "/login") return FALLBACK;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The Content-Security-Policy for Actual Bench's pages (RD-096). Built from
 * what the app actually loads, not a template:
 *
 * - Scripts: only those carrying this response's nonce (Next adds it to its own
 *   scripts), and what they load in turn (`'strict-dynamic'`: code-split
 *   chunks, the Vercel demo's analytics). `'wasm-unsafe-eval'` lets SQLite
 *   compile its WebAssembly, in Actual's browser runtime and in Budget
 *   Diagnostics; it allows WebAssembly only, not `eval`.
 * - Styles: `'unsafe-inline'`, because React writes `style` attributes, which
 *   a nonce cannot cover. Script injection is what the policy is for.
 * - Connections: any http(s) address. Direct mode talks to the Actual Server
 *   the user typed, from the browser; Bench cannot know it in advance. So this
 *   policy does not stop data leaving, and is not meant to.
 * - Workers: this site, plus `blob:` and `data:`, which Actual's browser
 *   runtime starts its worker from.
 */

export const CSP_NONCE_HEADER = "x-nonce";

export function contentSecurityPolicy({ nonce, dev }: { nonce: string; dev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Development only: React's dev build uses eval for error stacks.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    // Development only: the hot-reload socket.
    "connect-src": ["'self'", "https:", "http:", ...(dev ? ["ws:", "wss:"] : [])],
    "worker-src": ["'self'", "blob:", "data:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

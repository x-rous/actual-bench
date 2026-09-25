import { NextResponse, type NextRequest } from "next/server";

/**
 * Cross-origin isolation headers Direct Actual Server mode needs
 * (`window.crossOriginIsolated`). Applied to every page unconditionally: Bench
 * never loads a cross-origin subresource itself, so this doesn't break
 * anything for an operator who only uses HTTP API Server mode. If a
 * reverse proxy strips these and Direct mode genuinely can't work in a given
 * environment, `assertDirectBrowserApiEnvironment` reports that clearly at
 * the point of use instead.
 */
const DIRECT_MODE_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True when a browser sent this state-changing API request from another site.
 * Such a request can fire without the user knowing (a form or `fetch` on any
 * page they visit), and the routes parse their body whatever the Content-Type
 * says, so it is refused here, in one place, before any route runs.
 *
 * Browsers say where a request came from in `Sec-Fetch-Site`; older ones only
 * in `Origin`, compared with the host the request was addressed to (as the
 * reverse proxy forwarded it). A request carrying neither header is not from a
 * browser page (curl, a script) and passes.
 */
export function isCrossSiteWrite(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = request.headers.get("origin");
  if (!origin) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // "null" (sandboxed frames, file: pages) or garbage
  }

  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return !hosts.includes(originHost);
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (isCrossSiteWrite(request)) {
      return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
    }
    return NextResponse.next();
  }

  const response = NextResponse.next();

  for (const [key, value] of Object.entries(DIRECT_MODE_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: ["/(.*)"],
};

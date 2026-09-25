import { NextResponse, type NextRequest } from "next/server";
import { authMode } from "@/lib/auth/authMode";
import { isOpenPath, safeNextPath } from "@/lib/auth/openPaths";
import { readSessionToken } from "@/lib/connectionVault/cookies";
import { hasSession } from "@/lib/connectionVault/session";

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
 * in `Origin`, compared with the scheme and host the request was addressed to
 * (as the reverse proxy forwarded them). A request carrying neither header is
 * not from a browser page (curl, a script) and passes.
 */
export function isCrossSiteWrite(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  const origin = request.headers.get("origin");
  if (!origin) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return true; // "null" (sandboxed frames, file: pages) or garbage
  }

  // An http:// page on the same host is another origin than the https:// app.
  const scheme = externalScheme(request);
  if (scheme && originUrl.protocol !== scheme) return true;

  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return !hosts.includes(originUrl.host);
}

/**
 * The scheme the browser used, when Bench can know it: the proxy's
 * `X-Forwarded-Proto`, or a direct HTTPS connection. A proxy that terminates
 * TLS without that header looks like plain HTTP, so then the scheme is unknown
 * and only the host is compared, rather than refusing its users' writes.
 */
function externalScheme(request: NextRequest): string | null {
  const forwarded = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  if (forwarded) return `${forwarded.toLowerCase()}:`;
  return request.nextUrl.protocol === "https:" ? "https:" : null;
}

/**
 * The sign-in gate (RD-096). Signed in means the saved-connections vault is
 * unlocked for this browser: one password, one session. Pages send a signed-out
 * visitor to the sign-in page and back; API calls answer 401, marked so the
 * app can tell it apart from a budget server's own 401 and do the same.
 */
function signInResponse(request: NextRequest): NextResponse | null {
  if (authMode() === "none") return null;

  const { pathname, search } = request.nextUrl;
  const signedIn = hasSession(readSessionToken(request));

  if (pathname === "/login") {
    if (!signedIn) return null;
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(next, request.url));
  }
  if (signedIn || isOpenPath(pathname)) return null;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Sign in to continue.", code: "SIGNED_OUT" },
      { status: 401, headers: { "X-Bench-Auth": "signed-out" } }
    );
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export function proxy(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (isApi && isCrossSiteWrite(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }

  const gate = signInResponse(request);
  if (gate) return gate;

  if (isApi) return NextResponse.next();

  const response = NextResponse.next();

  for (const [key, value] of Object.entries(DIRECT_MODE_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: ["/(.*)"],
};

import { NextResponse } from "next/server";

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

export function proxy() {
  const response = NextResponse.next();

  for (const [key, value] of Object.entries(DIRECT_MODE_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: ["/((?!api/).*)"],
};

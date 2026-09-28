import type { NextRequest, NextResponse } from "next/server";
import { keepsSignedIn, vaultUnlockDurationMs, type VaultUnlockDuration } from "./unlockDuration";

/**
 * Session cookie helpers for the remembered-connection vault (RD-061 / PR-026b).
 * The cookie carries only the opaque unlock token — never a secret or key.
 */

export const VAULT_COOKIE = "ab_vault_session";

/** True when the request arrived over HTTPS (direct or via a trusting proxy). */
function isSecureRequest(request: NextRequest): boolean {
  const forwarded = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  try {
    return request.nextUrl?.protocol === "https:";
  } catch {
    return false;
  }
}

export function readSessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(VAULT_COOKIE)?.value;
}

export function setSessionCookie(
  request: NextRequest,
  response: NextResponse,
  token: string,
  duration?: VaultUnlockDuration
): void {
  // Not kept signed in: a browser-session cookie (no Max-Age), so closing the
  // browser signs you out; the server's idle limit still applies meanwhile.
  const kept = duration !== undefined && keepsSignedIn(duration);
  response.cookies.set(VAULT_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    ...(kept ? { maxAge: Math.floor(vaultUnlockDurationMs(duration) / 1000) } : {}),
  });
}

/** Clears the cookie with the same attributes it was set with, `Secure` included. */
export function clearSessionCookie(request: NextRequest, response: NextResponse): void {
  response.cookies.set(VAULT_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0,
  });
}

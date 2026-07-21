import type { NextRequest, NextResponse } from "next/server";
import { SESSION_IDLE_TTL_MS } from "./session";

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

export function setSessionCookie(request: NextRequest, response: NextResponse, token: string): void {
  response.cookies.set(VAULT_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: Math.floor(SESSION_IDLE_TTL_MS / 1000),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(VAULT_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

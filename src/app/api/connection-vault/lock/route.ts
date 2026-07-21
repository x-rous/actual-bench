import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "@/lib/connectionVault/session";
import { clearSessionCookie, readSessionToken } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lock this session (RD-061 / PR-026b): drop the in-memory key and clear the
 * cookie. Always succeeds — locking an already-locked session is a no-op.
 */
export function POST(request: NextRequest) {
  clearSession(readSessionToken(request));
  const response = NextResponse.json({ ok: true, unlocked: false });
  clearSessionCookie(response);
  return response;
}

import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import { isPassphraseSet, verifyPassphrase } from "@/lib/connectionVault/passphrase";
import { createSession } from "@/lib/connectionVault/session";
import { setSessionCookie } from "@/lib/connectionVault/cookies";
import { recordUnlockFailure, recordUnlockSuccess, unlockRetryAfterMs } from "@/lib/connectionVault/throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Unlock the remembered-connection vault for this session (RD-061 / PR-026b).
 * Verifies the passphrase, caches the derived key in server memory, and sets the
 * opaque session cookie. Never returns the key or any secret.
 */
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json(
        { error: "Remembering credentials requires a durable metadata database." },
        { status: 400 }
      );
    }
    const body = (await readJsonBody(request)) as { passphrase?: unknown };
    if (typeof body?.passphrase !== "string") {
      return NextResponse.json({ error: "passphrase is required." }, { status: 400 });
    }
    const db = getAppDb();
    if (!isPassphraseSet(db)) {
      return NextResponse.json({ error: "No passphrase is set." }, { status: 400 });
    }
    // Brute-force backoff: reject while locked out after repeated failures.
    const retryMs = unlockRetryAfterMs();
    if (retryMs > 0) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryMs / 1000)) } }
      );
    }
    const key = verifyPassphrase(db, body.passphrase);
    if (!key) {
      recordUnlockFailure();
      return NextResponse.json({ error: "Incorrect passphrase." }, { status: 401 });
    }
    recordUnlockSuccess();
    const response = NextResponse.json({ ok: true, unlocked: true });
    setSessionCookie(request, response, createSession(key));
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

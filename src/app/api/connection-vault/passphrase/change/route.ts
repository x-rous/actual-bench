import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import { changePassphrase, isPassphraseSet, verifyPassphrase } from "@/lib/connectionVault/passphrase";
import { clearAllSessions, createSession } from "@/lib/connectionVault/session";
import { setSessionCookie } from "@/lib/connectionVault/cookies";
import { recordUnlockFailure, recordUnlockSuccess, unlockRetryAfterMs } from "@/lib/connectionVault/throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_PASSPHRASE_LENGTH = 8;

/**
 * Change the vault passphrase (RD-061 / PR-026b): re-seals every remembered
 * credential + the verifier under the new key, invalidates all existing
 * sessions (they hold the old key), and re-unlocks the caller.
 */
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json(
        { error: "Remembering credentials requires a durable metadata database." },
        { status: 400 }
      );
    }
    const body = (await readJsonBody(request)) as { currentPassphrase?: unknown; newPassphrase?: unknown };
    if (typeof body?.currentPassphrase !== "string" || typeof body?.newPassphrase !== "string") {
      return NextResponse.json({ error: "currentPassphrase and newPassphrase are required." }, { status: 400 });
    }
    if (body.newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      return NextResponse.json(
        { error: `newPassphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.` },
        { status: 400 }
      );
    }
    const db = getAppDb();
    if (!isPassphraseSet(db)) {
      return NextResponse.json({ error: "No passphrase is set." }, { status: 400 });
    }
    // Share the unlock brute-force backoff — this also verifies a guessed passphrase.
    const retryMs = unlockRetryAfterMs();
    if (retryMs > 0) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryMs / 1000)) } }
      );
    }
    if (!changePassphrase(db, body.currentPassphrase, body.newPassphrase)) {
      recordUnlockFailure();
      return NextResponse.json({ error: "Incorrect current passphrase." }, { status: 401 });
    }
    recordUnlockSuccess();
    clearAllSessions();
    const key = verifyPassphrase(db, body.newPassphrase);
    if (!key) return NextResponse.json({ error: "Failed to re-establish the passphrase." }, { status: 500 });
    const response = NextResponse.json({ ok: true, unlocked: true });
    setSessionCookie(request, response, createSession(key));
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

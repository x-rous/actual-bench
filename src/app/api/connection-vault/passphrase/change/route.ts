import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/credentials/passphraseVaultKey";
import { changePassphrase, isPassphraseSet, verifyPassphrase } from "@/lib/connectionVault/passphrase";
import { clearAllSessions, createSession } from "@/lib/connectionVault/session";
import { setSessionCookie } from "@/lib/connectionVault/cookies";
import {
  recordUnlockFailure,
  recordUnlockSuccess,
  throttleClientKey,
  unlockRetryAfterMs,
} from "@/lib/connectionVault/throttle";
import {
  DEFAULT_VAULT_UNLOCK_DURATION,
  isVaultUnlockDuration,
} from "@/lib/connectionVault/unlockDuration";
import { MIN_PASSWORD_LENGTH, passwordFromEnv } from "@/lib/auth/authMode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    if (passwordFromEnv() !== null) {
      // The next restart would put the environment's password back, clearing
      // everything sealed with the one chosen here.
      return NextResponse.json(
        { error: "The password is set by ACTUAL_BENCH_PASSWORD. Change it there and restart." },
        { status: 409 }
      );
    }
    const body = (await readJsonBody(request)) as {
      currentPassphrase?: unknown;
      newPassphrase?: unknown;
      duration?: unknown;
    };
    if (typeof body?.currentPassphrase !== "string" || typeof body?.newPassphrase !== "string") {
      return NextResponse.json({ error: "Enter your current password and a new one." }, { status: 400 });
    }
    if (body.duration !== undefined && !isVaultUnlockDuration(body.duration)) {
      return NextResponse.json({ error: "Unsupported vault unlock duration." }, { status: 400 });
    }
    if (body.newPassphrase.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }
    const db = getAppDb();
    if (!isPassphraseSet(db)) {
      return NextResponse.json({ error: "No password is set." }, { status: 400 });
    }
    // Share the unlock brute-force backoff — this also verifies a guessed passphrase.
    const client = throttleClientKey(request.headers);
    const retryMs = unlockRetryAfterMs(client);
    if (retryMs > 0) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryMs / 1000)) } }
      );
    }
    if (!changePassphrase(db, body.currentPassphrase, body.newPassphrase)) {
      recordUnlockFailure(client);
      return NextResponse.json({ error: "Incorrect current password." }, { status: 401 });
    }
    recordUnlockSuccess(client);
    clearAllSessions();
    const key = verifyPassphrase(db, body.newPassphrase);
    if (!key) return NextResponse.json({ error: "Failed to re-establish the password." }, { status: 500 });
    const response = NextResponse.json({ ok: true, unlocked: true });
    const duration = body.duration ?? DEFAULT_VAULT_UNLOCK_DURATION;
    setSessionCookie(request, response, createSession(key, duration), duration);
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

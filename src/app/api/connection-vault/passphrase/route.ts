import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/credentials/passphraseVaultKey";
import { isPassphraseSet, setPassphrase, verifyPassphrase } from "@/lib/connectionVault/passphrase";
import { createSession } from "@/lib/connectionVault/session";
import { setSessionCookie } from "@/lib/connectionVault/cookies";
import {
  DEFAULT_VAULT_UNLOCK_DURATION,
  isVaultUnlockDuration,
} from "@/lib/connectionVault/unlockDuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_PASSPHRASE_LENGTH = 8;

/**
 * Set the vault passphrase for the first time (RD-061 / PR-026b), then unlock the
 * caller's session. Rejects if a passphrase is already set (use change instead).
 */
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json(
        { error: "Remembering credentials requires a durable metadata database." },
        { status: 400 }
      );
    }
    const body = (await readJsonBody(request)) as { passphrase?: unknown; duration?: unknown };
    if (typeof body?.passphrase !== "string" || body.passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return NextResponse.json(
        { error: `passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (body.duration !== undefined && !isVaultUnlockDuration(body.duration)) {
      return NextResponse.json({ error: "Unsupported vault unlock duration." }, { status: 400 });
    }
    const db = getAppDb();
    if (isPassphraseSet(db)) {
      return NextResponse.json({ error: "A passphrase is already set." }, { status: 409 });
    }
    setPassphrase(db, body.passphrase);
    const key = verifyPassphrase(db, body.passphrase);
    if (!key) {
      // Should never happen right after setting; fail closed rather than guess.
      return NextResponse.json({ error: "Failed to establish the passphrase." }, { status: 500 });
    }
    const response = NextResponse.json({ ok: true, unlocked: true });
    const duration = body.duration ?? DEFAULT_VAULT_UNLOCK_DURATION;
    setSessionCookie(request, response, createSession(key, duration), duration);
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

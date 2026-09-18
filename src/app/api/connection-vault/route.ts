import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import { isPassphraseSet } from "@/lib/connectionVault/passphrase";
import { getSessionDuration, hasSession } from "@/lib/connectionVault/session";
import { readSessionToken, setSessionCookie } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Remembered-connection vault status (RD-061 / PR-026b). Non-secret metadata for
 * the connect UI: whether the feature is available here, whether a passphrase is
 * set, and whether this session is unlocked.
 */
export function GET(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json({ supported: false, passphraseSet: false, unlocked: false });
    }
    const db = getAppDb();
    const token = readSessionToken(request);
    const unlocked = hasSession(token);
    const duration = unlocked ? getSessionDuration(token) : null;
    const response = NextResponse.json({
      supported: true,
      passphraseSet: isPassphraseSet(db),
      unlocked,
    });
    if (token && duration) setSessionCookie(request, response, token, duration);
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

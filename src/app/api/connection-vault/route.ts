import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/credentials/passphraseVaultKey";
import { isPassphraseSet } from "@/lib/connectionVault/passphrase";
import { getSessionDuration, hasSession } from "@/lib/connectionVault/session";
import { readSessionToken, setSessionCookie } from "@/lib/connectionVault/cookies";
import { authMode, passwordFromEnv } from "@/lib/auth/authMode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Remembered-connection vault status (RD-061 / PR-026b). Non-secret metadata for
 * the connect UI: whether the feature is available here, whether a password is
 * set, and whether this session is unlocked. Also what the sign-in page needs
 * (RD-096): whether Bench asks for the password at all, and whether the
 * operator set it in the environment (then it can't be changed here).
 */
export function GET(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json({
        supported: false,
        passphraseSet: false,
        unlocked: false,
        authMode: authMode(),
        passwordFromEnv: false,
      });
    }
    const db = getAppDb();
    const token = readSessionToken(request);
    const unlocked = hasSession(token);
    const mode = authMode();
    const duration = unlocked ? getSessionDuration(token) : null;
    const response = NextResponse.json({
      supported: true,
      passphraseSet: isPassphraseSet(db),
      unlocked,
      authMode: mode,
      // Only for someone already in: a signed-out visitor learns nothing about
      // how the password is managed.
      passwordFromEnv: (unlocked || mode === "none") && passwordFromEnv() !== null,
    });
    if (token && duration) setSessionCookie(request, response, token, duration);
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

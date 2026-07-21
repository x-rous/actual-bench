import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import { isPassphraseSet } from "@/lib/connectionVault/passphrase";
import { hasSession } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";

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
    return NextResponse.json({
      supported: true,
      passphraseSet: isPassphraseSet(db),
      unlocked: hasSession(readSessionToken(request)),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

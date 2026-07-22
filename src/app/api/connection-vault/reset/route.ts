import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import { resetVault } from "@/lib/connectionVault/passphrase";
import { clearAllSessions } from "@/lib/connectionVault/session";
import { resetUnlockThrottle } from "@/lib/connectionVault/throttle";
import { clearSessionCookie } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reset the remembered-connection vault (RD-061 / PR-026) — recovery for a
 * forgotten passphrase. Removes all remembered connections and clears the
 * passphrase so a new one can be set. Requires no passphrase (it's forgotten);
 * only ever discards data, never exposes a secret.
 */
export function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json(
        { error: "Remembering credentials requires a durable metadata database." },
        { status: 400 }
      );
    }
    resetVault(getAppDb());
    clearAllSessions();
    resetUnlockThrottle();
    void request;
    const response = NextResponse.json({ ok: true, reset: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

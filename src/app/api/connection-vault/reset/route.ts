import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import { resetVault } from "@/lib/connectionVault/passphrase";
import { clearAllSessions } from "@/lib/connectionVault/session";
import { clearSessionCookie } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reset the vault when the passphrase is forgotten (RD-063). Drops all saved
 * servers + budget passwords and clears the passphrase so the user can set a new
 * one — no secret is exposed, and no passphrase is required (a forgotten one
 * couldn't be supplied). All sessions are invalidated.
 */
export async function POST() {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json(
        { error: "Remembering credentials requires a durable metadata database." },
        { status: 400 }
      );
    }
    resetVault(getAppDb());
    clearAllSessions();
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/credentials/passphraseVaultKey";
import { resetVault } from "@/lib/connectionVault/passphrase";
import { clearAllSessions } from "@/lib/connectionVault/session";
import { clearSessionCookie } from "@/lib/connectionVault/cookies";
import { authMode } from "@/lib/auth/authMode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reset the vault when the passphrase is forgotten (RD-063). Drops all saved
 * servers + budget passwords and clears the passphrase so the user can set a new
 * one — no secret is exposed, and no passphrase is required (a forgotten one
 * couldn't be supplied). All sessions are invalidated.
 */
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json(
        { error: "Remembering credentials requires a durable metadata database." },
        { status: 400 }
      );
    }
    if (authMode() === "password") {
      // With sign-in on, this password is the app's password: clearing it
      // would leave the first visitor to set a new one. Whoever is signed in
      // knows it; a forgotten one is recovered with ACTUAL_BENCH_PASSWORD.
      return NextResponse.json(
        { error: "Set ACTUAL_BENCH_PASSWORD and restart to replace a forgotten password." },
        { status: 409 }
      );
    }
    resetVault(getAppDb());
    clearAllSessions();
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(request, response);
    return response;
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

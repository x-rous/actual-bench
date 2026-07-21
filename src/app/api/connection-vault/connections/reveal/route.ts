import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  getConnectionCredential,
  rememberedCredentialsSupported,
} from "@/lib/app-db/connectionCredentialRepository";
import { getSessionKey } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Direct-mode secret release (RD-061 / PR-026d). Because Direct mode runs the
 * Actual engine in the browser, reconnecting a remembered Direct connection
 * requires releasing its `serverPassword` to the browser — the deliberate,
 * clearly-labelled weaker path. This is the ONLY endpoint that returns a stored
 * plaintext secret, and only via an explicit unlock action for a browser-api
 * record. HTTP-API keys are never released here (they inject server-side).
 */
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json(
        { error: "Remembering credentials requires a durable metadata database." },
        { status: 400 }
      );
    }
    const key = getSessionKey(readSessionToken(request));
    if (!key) {
      return NextResponse.json({ error: "Vault is locked. Unlock to reconnect." }, { status: 401 });
    }
    const body = (await readJsonBody(request)) as { connectionFingerprint?: unknown };
    if (typeof body.connectionFingerprint !== "string") {
      return NextResponse.json({ error: "connectionFingerprint is required." }, { status: 400 });
    }
    let cred;
    try {
      cred = getConnectionCredential(getAppDb(), body.connectionFingerprint, key);
    } catch {
      return NextResponse.json({ error: "Could not decrypt the remembered connection." }, { status: 401 });
    }
    if (!cred) {
      return NextResponse.json({ error: "Remembered connection not found." }, { status: 404 });
    }
    if (cred.mode !== "browser-api" || !cred.secret.serverPassword) {
      // HTTP-API keys stay server-side; never released to the browser.
      return NextResponse.json({ error: "This connection's secret is not released to the browser." }, { status: 400 });
    }
    return NextResponse.json({
      baseUrl: cred.baseUrl,
      budgetSyncId: cred.budgetSyncId,
      label: cred.label,
      secret: {
        serverPassword: cred.secret.serverPassword,
        encryptionPassword: cred.secret.encryptionPassword ?? null,
      },
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

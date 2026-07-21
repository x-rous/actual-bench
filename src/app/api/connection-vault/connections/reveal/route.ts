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
 * Reveal a remembered connection's secret to reconnect (RD-061 / PR-026d, Option
 * B). The vault unseals the stored secret with the unlocked session key and
 * returns it so the browser can rebuild a normal connection — HTTP `apiKey` or
 * Direct `serverPassword`, plus any budget `encryptionPassword`. This is the
 * single, explicit "release for reconnect" action; it requires an unlocked
 * session and never returns anything from list/metadata endpoints.
 *
 * Browser exposure is identical to a freshly-typed connection; the vault only
 * adds encryption-at-rest + passphrase-gating on top.
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
    return NextResponse.json({
      mode: cred.mode,
      baseUrl: cred.baseUrl,
      budgetSyncId: cred.budgetSyncId,
      label: cred.label,
      secret: {
        apiKey: cred.secret.apiKey ?? null,
        serverPassword: cred.secret.serverPassword ?? null,
        encryptionPassword: cred.secret.encryptionPassword ?? null,
      },
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

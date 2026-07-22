import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import {
  getBudgetEncryptionPassword,
  getServerCredential,
} from "@/lib/app-db/serverCredentialRepository";
import { getSessionKey } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reveal a remembered server's secret to reconnect (RD-063 / PR-028b, Option B).
 * Unseals the stored server secret with the unlocked session key and returns it
 * so the browser can rebuild a normal connection — HTTP `apiKey` or Direct
 * `serverPassword`. When `budgetSyncId` is supplied and that budget has a
 * remembered encryption password, it is returned too so an encrypted budget
 * opens without a second prompt.
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
    const body = (await readJsonBody(request)) as { serverFingerprint?: unknown; budgetSyncId?: unknown };
    if (typeof body.serverFingerprint !== "string") {
      return NextResponse.json({ error: "serverFingerprint is required." }, { status: 400 });
    }
    const db = getAppDb();
    let cred;
    let encryptionPassword: string | null = null;
    try {
      cred = getServerCredential(db, body.serverFingerprint, key);
      if (cred && typeof body.budgetSyncId === "string" && body.budgetSyncId) {
        encryptionPassword = getBudgetEncryptionPassword(db, body.serverFingerprint, body.budgetSyncId, key);
      }
    } catch {
      return NextResponse.json({ error: "Could not decrypt the remembered server." }, { status: 401 });
    }
    if (!cred) {
      return NextResponse.json({ error: "Remembered server not found." }, { status: 404 });
    }
    return NextResponse.json({
      mode: cred.mode,
      baseUrl: cred.baseUrl,
      label: cred.label,
      secret: {
        apiKey: cred.secret.apiKey ?? null,
        serverPassword: cred.secret.serverPassword ?? null,
        encryptionPassword,
      },
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

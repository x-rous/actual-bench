import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { EnrolmentRefusedError, startEnrolment } from "@/lib/credentials/enrolments";
import { deleteSyncCredential, listSyncCredentialMeta } from "@/lib/credentials/unattendedCredentials";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { getVaultSummary } from "@/lib/credentials/vaultState";
import { lockedVaultResponse } from "@/lib/credentials/vaultResponse";
import type { SyncCredentialInput } from "@/lib/app-db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Credential vault API (RD-058 / PR-024a). Write-only from the client's side:
 * enroll (POST, checked first; see `enrolments/[id]`) / withdraw (DELETE) /
 * list metadata (GET). The secret is never returned - GET yields only
 * non-secret metadata + whether the vault is ready or locked.
 */

// GET → { vault, credentials: [metadata only] }
export function GET() {
  try {
    const db = getAppDb();
    return NextResponse.json({ vault: getVaultSummary(db), credentials: listSyncCredentialMeta(db) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// POST → start enrolling a connection: check it against its server, then store
// it. Answers 202 with an id to follow; nothing is stored unless the check
// passes (RD-095 M4).
export async function POST(request: Request) {
  try {
    const locked = lockedVaultResponse(getAppDb());
    if (locked) return locked;
    const body = (await readJsonBody(request)) as SyncCredentialInput;
    if (!body?.connectionFingerprint || !body?.baseUrl || !body?.budgetSyncId) {
      return NextResponse.json(
        { error: "connectionFingerprint, baseUrl and budgetSyncId are required." },
        { status: 400 }
      );
    }
    if (body.mode !== "http-api" && body.mode !== "browser-api") {
      return NextResponse.json({ error: "Unknown connection mode." }, { status: 400 });
    }
    // The fingerprint must be the one the connection's own details give. It is
    // the record's key, and an enrolment can use its server's saved password,
    // so a mismatched one could overwrite another budget's enrolment with a
    // different server's details.
    if (body.connectionFingerprint !== connectionFingerprint({ ...body, mode: body.mode })) {
      return NextResponse.json(
        { error: "The connection fingerprint does not match its mode, server and budget." },
        { status: 400 }
      );
    }

    // Without its own password or key, an enrolment uses the one saved for its
    // server (PR-071a); `startEnrolment` refuses if there is none.
    const secret = body.secret ?? {};

    // Only the secret that belongs to the mode is kept.
    const input: SyncCredentialInput = {
      connectionFingerprint: body.connectionFingerprint,
      mode: body.mode,
      baseUrl: body.baseUrl,
      budgetSyncId: body.budgetSyncId,
      ...(body.label ? { label: body.label } : {}),
      secret: {
        ...(body.mode === "http-api"
          ? secret.apiKey
            ? { apiKey: secret.apiKey }
            : {}
          : secret.serverPassword
            ? { serverPassword: secret.serverPassword }
            : {}),
        ...(secret.encryptionPassword ? { encryptionPassword: secret.encryptionPassword } : {}),
      },
    };

    try {
      const enrolmentId = startEnrolment(input);
      return NextResponse.json({ enrolmentId }, { status: 202 });
    } catch (error) {
      if (error instanceof EnrolmentRefusedError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "NO_SECRET" ? 400 : 503 });
      }
      throw error;
    }
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// DELETE ?connectionFingerprint=… → withdraw an enrolled credential.
export function DELETE(request: NextRequest) {
  try {
    const fingerprint = request.nextUrl.searchParams.get("connectionFingerprint");
    if (!fingerprint) {
      return NextResponse.json({ error: "connectionFingerprint is required." }, { status: 400 });
    }
    deleteSyncCredential(getAppDb(), fingerprint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

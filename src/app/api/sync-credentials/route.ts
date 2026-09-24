import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { EnrolmentRefusedError, startEnrolment } from "@/lib/credentials/enrolments";
import { deleteSyncCredential, listSyncCredentialMeta } from "@/lib/credentials/unattendedCredentials";
import { vaultEnabled } from "@/lib/sync/vault";
import type { SyncCredentialInput } from "@/lib/app-db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Credential vault API (RD-058 / PR-024a). Write-only from the client's side:
 * enroll (POST, checked first; see `enrolments/[id]`) / withdraw (DELETE) /
 * list metadata (GET). The secret is never returned - GET yields only
 * non-secret metadata + whether the vault is enabled.
 */

// GET → { enabled, credentials: [metadata only] }
export function GET() {
  try {
    if (!vaultEnabled()) {
      return NextResponse.json({ enabled: false, credentials: [] });
    }
    return NextResponse.json({ enabled: true, credentials: listSyncCredentialMeta(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// POST → start enrolling a connection: check it against its server, then store
// it. Answers 202 with an id to follow; nothing is stored unless the check
// passes (RD-095 M4).
export async function POST(request: Request) {
  try {
    if (!vaultEnabled()) {
      return NextResponse.json(
        { error: "The credential vault is disabled. Set SYNC_VAULT_KEY to enable unattended sync." },
        { status: 400 }
      );
    }
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
    if (body.mode === "http-api" && !body.secret?.apiKey) {
      return NextResponse.json({ error: "An HTTP API connection is enrolled with its API key." }, { status: 400 });
    }
    if (body.mode === "browser-api" && !body.secret?.serverPassword) {
      return NextResponse.json({ error: "A Direct connection is enrolled with its server password." }, { status: 400 });
    }

    // Only the secret that belongs to the mode is kept.
    const input: SyncCredentialInput = {
      connectionFingerprint: body.connectionFingerprint,
      mode: body.mode,
      baseUrl: body.baseUrl,
      budgetSyncId: body.budgetSyncId,
      ...(body.label ? { label: body.label } : {}),
      secret: {
        ...(body.mode === "http-api" ? { apiKey: body.secret.apiKey } : { serverPassword: body.secret.serverPassword }),
        ...(body.secret.encryptionPassword ? { encryptionPassword: body.secret.encryptionPassword } : {}),
      },
    };

    try {
      const enrolmentId = startEnrolment(input);
      return NextResponse.json({ enrolmentId }, { status: 202 });
    } catch (error) {
      if (error instanceof EnrolmentRefusedError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
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

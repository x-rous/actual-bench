import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteSyncCredential,
  listSyncCredentialMeta,
  upsertSyncCredential,
} from "@/lib/app-db/syncCredentialRepository";
import { vaultEnabled } from "@/lib/sync/vault";
import type { SyncCredentialInput } from "@/lib/app-db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Credential vault API (RD-058 / PR-024a). Write-only from the client's side:
 * enroll (POST) / withdraw (DELETE) / list metadata (GET). The secret is never
 * returned - GET yields only non-secret metadata + whether the vault is enabled.
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

// POST → enroll (seal + store) a connection's secret for unattended sync.
export async function POST(request: Request) {
  try {
    if (!vaultEnabled()) {
      return NextResponse.json(
        { error: "The credential vault is disabled. Set SYNC_VAULT_KEY to enable unattended sync." },
        { status: 400 }
      );
    }
    const body = (await readJsonBody(request)) as SyncCredentialInput;
    if (!body?.connectionFingerprint || !body?.secret?.apiKey) {
      return NextResponse.json({ error: "connectionFingerprint and secret.apiKey are required." }, { status: 400 });
    }
    if (!body?.baseUrl || !body?.budgetSyncId) {
      return NextResponse.json({ error: "baseUrl and budgetSyncId are required." }, { status: 400 });
    }
    if (body.mode !== "http-api") {
      // Hybrid (RD-058): only HTTP-API connections can run unattended server-side.
      return NextResponse.json({ error: "Only HTTP API Server connections can be enrolled for unattended sync." }, { status: 400 });
    }
    const meta = upsertSyncCredential(getAppDb(), body);
    return NextResponse.json({ credential: meta }, { status: 201 });
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

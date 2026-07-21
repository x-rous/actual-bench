import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import {
  deleteConnectionCredential,
  listConnectionCredentialMeta,
  rememberedCredentialsSupported,
  upsertConnectionCredential,
} from "@/lib/app-db/connectionCredentialRepository";
import { getSessionKey } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import type { ConnectionCredentialSecret } from "@/lib/app-db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Remembered connections API (RD-061 / PR-026d). Enroll (POST) / list metadata
 * (GET) / forget (DELETE). Enrolling requires an unlocked session (the key seals
 * the secret); listing is metadata-only and available before unlock so the
 * reconnect screen can show remembered connections.
 */

function unsupported(): NextResponse {
  return NextResponse.json(
    { error: "Remembering credentials requires a durable metadata database." },
    { status: 400 }
  );
}

// GET → remembered connection metadata (never secrets).
export function GET() {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json({ supported: false, connections: [] });
    }
    return NextResponse.json({ supported: true, connections: listConnectionCredentialMeta(getAppDb()) });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// POST → remember (seal + store) a connection under the unlocked session key.
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const key = getSessionKey(readSessionToken(request));
    if (!key) {
      return NextResponse.json({ error: "Vault is locked. Unlock before remembering a connection." }, { status: 401 });
    }
    const body = (await readJsonBody(request)) as {
      mode?: unknown;
      baseUrl?: unknown;
      budgetSyncId?: unknown;
      label?: unknown;
      secret?: ConnectionCredentialSecret;
    };
    if (
      (body.mode !== "http-api" && body.mode !== "browser-api") ||
      typeof body.baseUrl !== "string" ||
      typeof body.budgetSyncId !== "string"
    ) {
      return NextResponse.json({ error: "mode, baseUrl and budgetSyncId are required." }, { status: 400 });
    }
    const secret = body.secret ?? {};
    const hasSecret = body.mode === "http-api" ? !!secret.apiKey : !!secret.serverPassword;
    if (!hasSecret) {
      return NextResponse.json({ error: "A mode-appropriate secret is required." }, { status: 400 });
    }
    const fingerprint = connectionFingerprint({
      mode: body.mode,
      baseUrl: body.baseUrl,
      budgetSyncId: body.budgetSyncId,
    });
    const meta = upsertConnectionCredential(
      getAppDb(),
      {
        connectionFingerprint: fingerprint,
        mode: body.mode,
        baseUrl: body.baseUrl,
        budgetSyncId: body.budgetSyncId,
        label: typeof body.label === "string" ? body.label : "",
        secret,
      },
      key
    );
    return NextResponse.json({ connection: meta }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// DELETE ?connectionFingerprint=… → forget a remembered connection.
export function DELETE(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const fingerprint = request.nextUrl.searchParams.get("connectionFingerprint");
    if (!fingerprint) {
      return NextResponse.json({ error: "connectionFingerprint is required." }, { status: 400 });
    }
    deleteConnectionCredential(getAppDb(), fingerprint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

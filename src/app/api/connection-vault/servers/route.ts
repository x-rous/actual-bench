import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import {
  deleteServerCredential,
  listRememberedBudgets,
  listServerCredentialMeta,
  upsertServerCredential,
} from "@/lib/app-db/serverCredentialRepository";
import { getSessionKey } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";
import type { ServerCredentialSecret } from "@/lib/app-db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-scoped remembered credentials (RD-063 / PR-028b). A credential
 * authenticates you to a server (mode + URL), so one saved server opens any of
 * its budgets. Enroll (POST) / list metadata (GET) / forget (DELETE). Enrolling
 * requires an unlocked session (the key seals the secret); listing is
 * metadata-only and available before unlock so the reconnect screen can show
 * remembered servers.
 */

function unsupported(): NextResponse {
  return NextResponse.json(
    { error: "Remembering credentials requires a durable metadata database." },
    { status: 400 }
  );
}

// GET → remembered server + budget metadata (never secrets).
export function GET() {
  try {
    if (!rememberedCredentialsSupported()) {
      return NextResponse.json({ supported: false, servers: [], budgets: [] });
    }
    const db = getAppDb();
    return NextResponse.json({
      supported: true,
      servers: listServerCredentialMeta(db),
      budgets: listRememberedBudgets(db),
    });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// POST → remember (seal + store) a server under the unlocked session key.
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const key = getSessionKey(readSessionToken(request));
    if (!key) {
      return NextResponse.json({ error: "Vault is locked. Unlock before remembering a server." }, { status: 401 });
    }
    const body = (await readJsonBody(request)) as {
      mode?: unknown;
      baseUrl?: unknown;
      label?: unknown;
      secret?: ServerCredentialSecret;
    };
    if ((body.mode !== "http-api" && body.mode !== "browser-api") || typeof body.baseUrl !== "string") {
      return NextResponse.json({ error: "mode and baseUrl are required." }, { status: 400 });
    }
    const secret = body.secret ?? {};
    const hasSecret = body.mode === "http-api" ? !!secret.apiKey : !!secret.serverPassword;
    if (!hasSecret) {
      return NextResponse.json({ error: "A mode-appropriate secret is required." }, { status: 400 });
    }
    const meta = upsertServerCredential(
      getAppDb(),
      {
        mode: body.mode,
        baseUrl: body.baseUrl,
        label: typeof body.label === "string" ? body.label : "",
        secret,
      },
      key
    );
    return NextResponse.json({ server: meta }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// DELETE ?serverFingerprint=… → forget a server (and its budget encryption passwords).
export function DELETE(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const fingerprint = request.nextUrl.searchParams.get("serverFingerprint");
    if (!fingerprint) {
      return NextResponse.json({ error: "serverFingerprint is required." }, { status: 400 });
    }
    deleteServerCredential(getAppDb(), fingerprint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

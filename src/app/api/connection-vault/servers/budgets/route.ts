import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import {
  deleteRememberedBudget,
  hasServerCredential,
  upsertRememberedBudget,
} from "@/lib/app-db/serverCredentialRepository";
import { getSessionKey } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Remembered budgets under a server (RD-063 / PR-028f). Non-secret metadata — the
 * budget's sync id + display name — so the connect page can offer one-click
 * reconnect straight into a budget. Remember (POST) requires an unlocked session
 * (it's written right after a remembered connect); forget (DELETE) does not.
 */

function unsupported(): NextResponse {
  return NextResponse.json(
    { error: "Remembering credentials requires a durable metadata database." },
    { status: 400 }
  );
}

// POST → record a budget opened on a remembered server.
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const key = getSessionKey(readSessionToken(request));
    if (!key) {
      return NextResponse.json({ error: "Vault is locked. Unlock before remembering a budget." }, { status: 401 });
    }
    const body = (await readJsonBody(request)) as {
      serverFingerprint?: unknown;
      budgetSyncId?: unknown;
      name?: unknown;
    };
    if (typeof body.serverFingerprint !== "string" || typeof body.budgetSyncId !== "string" || !body.budgetSyncId) {
      return NextResponse.json({ error: "serverFingerprint and budgetSyncId are required." }, { status: 400 });
    }
    const db = getAppDb();
    if (!hasServerCredential(db, body.serverFingerprint)) {
      return NextResponse.json({ error: "Remember the server before its budgets." }, { status: 404 });
    }
    upsertRememberedBudget(db, {
      serverFingerprint: body.serverFingerprint,
      budgetSyncId: body.budgetSyncId,
      name: typeof body.name === "string" ? body.name : "",
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// DELETE ?serverFingerprint=…&budgetSyncId=… → forget a remembered budget (and its encryption password).
export function DELETE(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const serverFingerprint = request.nextUrl.searchParams.get("serverFingerprint");
    const budgetSyncId = request.nextUrl.searchParams.get("budgetSyncId");
    if (!serverFingerprint || !budgetSyncId) {
      return NextResponse.json({ error: "serverFingerprint and budgetSyncId are required." }, { status: 400 });
    }
    deleteRememberedBudget(getAppDb(), serverFingerprint, budgetSyncId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

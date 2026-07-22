import { NextResponse, type NextRequest } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse, readJsonBody } from "@/lib/app-db/routeResponses";
import { rememberedCredentialsSupported } from "@/lib/app-db/connectionCredentialRepository";
import {
  deleteBudgetEncryptionCredential,
  hasServerCredential,
  upsertBudgetEncryptionCredential,
} from "@/lib/app-db/serverCredentialRepository";
import { getSessionKey } from "@/lib/connectionVault/session";
import { readSessionToken } from "@/lib/connectionVault/cookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-budget encryption passwords under a remembered server (RD-063 / PR-028b).
 * Opt-in and kept separate from the server secret so revealing a server never
 * releases a budget's encryption password unless that budget is being opened.
 * Remember (POST) requires an unlocked session; forget (DELETE) does not, since
 * removing a sealed blob needs no key.
 */

function unsupported(): NextResponse {
  return NextResponse.json(
    { error: "Remembering credentials requires a durable metadata database." },
    { status: 400 }
  );
}

// POST → remember (seal + store) a budget's encryption password under its server.
export async function POST(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const key = getSessionKey(readSessionToken(request));
    if (!key) {
      return NextResponse.json({ error: "Vault is locked. Unlock before remembering a password." }, { status: 401 });
    }
    const body = (await readJsonBody(request)) as {
      serverFingerprint?: unknown;
      budgetSyncId?: unknown;
      label?: unknown;
      encryptionPassword?: unknown;
    };
    if (
      typeof body.serverFingerprint !== "string" ||
      typeof body.budgetSyncId !== "string" ||
      typeof body.encryptionPassword !== "string" ||
      !body.encryptionPassword
    ) {
      return NextResponse.json(
        { error: "serverFingerprint, budgetSyncId and encryptionPassword are required." },
        { status: 400 }
      );
    }
    const db = getAppDb();
    if (!hasServerCredential(db, body.serverFingerprint)) {
      return NextResponse.json({ error: "Remember the server before its budget passwords." }, { status: 404 });
    }
    upsertBudgetEncryptionCredential(
      db,
      {
        serverFingerprint: body.serverFingerprint,
        budgetSyncId: body.budgetSyncId,
        label: typeof body.label === "string" ? body.label : "",
        encryptionPassword: body.encryptionPassword,
      },
      key
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

// DELETE ?serverFingerprint=…&budgetSyncId=… → forget a budget's encryption password.
export function DELETE(request: NextRequest) {
  try {
    if (!rememberedCredentialsSupported()) return unsupported();
    const serverFingerprint = request.nextUrl.searchParams.get("serverFingerprint");
    const budgetSyncId = request.nextUrl.searchParams.get("budgetSyncId");
    if (!serverFingerprint || !budgetSyncId) {
      return NextResponse.json({ error: "serverFingerprint and budgetSyncId are required." }, { status: 400 });
    }
    deleteBudgetEncryptionCredential(getAppDb(), serverFingerprint, budgetSyncId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return appDbErrorResponse(error);
  }
}

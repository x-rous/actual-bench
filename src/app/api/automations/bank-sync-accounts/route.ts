import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { AppDbUnavailableError, AppDbValidationError } from "@/lib/app-db/errors";
import { sanitizeBankSyncError } from "@/lib/actual/bankSync";
import { getSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import { listAccountsForBankSync, isBankLinked } from "@/lib/actual/bankSyncAccounts";
import { vaultEnabled } from "@/lib/sync/vault";
import type { HttpApiConnection } from "@/store/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Which accounts a scheduled bank sync would actually pull (RD-080 / PR-045).
 *
 * The browser cannot answer this: the connection's credentials live in the
 * server-side vault, and the budget in question is often not the one currently
 * open. Without it the create dialog can only assert "every linked account is
 * synced" and hope — including when the honest answer is "none of them are
 * linked, so this automation would do nothing".
 *
 * Read-only, and returns account names and link state only — never any part of
 * the credential it used to ask.
 */
export async function GET(request: Request) {
  try {
    const fingerprint = new URL(request.url).searchParams.get("connection");
    if (!fingerprint) {
      return NextResponse.json({ error: "A connection is required." }, { status: 400 });
    }
    if (!vaultEnabled()) {
      return NextResponse.json({ error: "The credential vault is disabled." }, { status: 400 });
    }

    const credential = getSyncCredential(getAppDb(), fingerprint);
    if (!credential) {
      return NextResponse.json(
        { error: "That connection has no stored credentials." },
        { status: 404 }
      );
    }

    const connection: HttpApiConnection = {
      id: credential.connectionFingerprint,
      label: credential.label || credential.baseUrl,
      mode: "http-api",
      baseUrl: credential.baseUrl,
      apiKey: credential.secret.apiKey,
      budgetSyncId: credential.budgetSyncId,
      ...(credential.secret.encryptionPassword
        ? { encryptionPassword: credential.secret.encryptionPassword }
        : {}),
    };

    const accounts = await listAccountsForBankSync(connection);

    return NextResponse.json({
      accounts: accounts
        .filter((account) => !account.closed)
        .map((account) => ({
          id: account.id,
          name: account.name,
          linked: isBankLinked(account),
          syncSource: account.syncSource,
          lastSync: account.lastSync,
        })),
    });
  } catch (error) {
    // Upstream error text is forwarded verbatim by the proxy and can carry the
    // API key it was called with — a URL with credentials in it, or a server
    // echoing the header back. This route talks to actual-http-api with a vault
    // secret, so nothing from that side reaches the browser unsanitized.
    return appDbErrorResponse(sanitizeUpstreamError(error));
  }
}

function sanitizeUpstreamError(error: unknown): unknown {
  if (error instanceof AppDbValidationError || error instanceof AppDbUnavailableError) return error;
  return new Error(sanitizeBankSyncError(error));
}

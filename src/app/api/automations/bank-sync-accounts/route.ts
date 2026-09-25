import { NextResponse } from "next/server";
import { getAppDb } from "@/lib/app-db/connection";
import { appDbErrorResponse } from "@/lib/app-db/routeResponses";
import { AppDbUnavailableError, AppDbValidationError } from "@/lib/app-db/errors";
import { sanitizeBankSyncError } from "@/lib/actual/bankSync";
import { getSyncCredential, listSyncCredentialMeta } from "@/lib/credentials/unattendedCredentials";
import { listAccountsForBankSync, isBankLinked, type BankLinkedAccount } from "@/lib/actual/bankSyncAccounts";
import { actualErrorMessage, type ActualErrorCode } from "@/lib/actual/runtime/errors";
import { getAutomationExecutor } from "@/lib/automation/executor";
import { logger } from "@/lib/logger";
import { runWorkerTask } from "@/lib/workers/supervisor";
import { vaultEnabled } from "@/lib/sync/vault";
import { createHttpApiTransport } from "@/lib/actual/httpApiTransport";
import { connectionFromEnrolment } from "@/lib/actual/serverTransport";

export const dynamic = "force-dynamic";

type DirectAccountsOutput = { accounts: BankLinkedAccount[] } | { failed: ActualErrorCode };

/**
 * A cold open of a Direct budget. Usually a few seconds, because enrolment
 * refreshed its snapshot, but a budget whose snapshot has gone stale again can
 * take minutes - the same allowance as the enrolment check.
 */
const DIRECT_ACCOUNTS_DEADLINE_MS = 5 * 60_000;
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

    const db = getAppDb();
    const meta = listSyncCredentialMeta(db).find((entry) => entry.connectionFingerprint === fingerprint);
    if (!meta) {
      return NextResponse.json(
        { error: "That connection has no stored credentials." },
        { status: 404 }
      );
    }

    let accounts: BankLinkedAccount[];
    if (meta.mode === "browser-api") {
      // A Direct budget opens only in a worker (RD-095). The worker gets the
      // connection by reference and reveals the credential itself.
      if (getAutomationExecutor().name !== "worker") {
        return NextResponse.json(
          { error: "Direct connections need worker threads. Remove ACTUAL_BENCH_AUTOMATION_EXECUTOR=in-thread." },
          { status: 400 }
        );
      }
      const outcome = await runWorkerTask(
        "connection.bankAccounts",
        { connectionFingerprint: fingerprint },
        { signal: AbortSignal.timeout(DIRECT_ACCOUNTS_DEADLINE_MS) }
      );
      const output = outcome.status === "result" ? (outcome.output as DirectAccountsOutput | null) : null;
      if (output && "accounts" in output) {
        accounts = output.accounts;
      } else {
        // Fixed messages only: what a worker reports can carry internal detail
        // (paths, upstream text), so it goes to the server log, not the page.
        const busy = outcome.status === "stopped" && outcome.code === "NO_CAPACITY";
        const message = output && "failed" in output
          ? actualErrorMessage(output.failed)
          : busy
            ? "Bench is busy running automations. Try again in a minute."
            : outcome.status === "stopped" && outcome.code === "TIMEOUT"
              ? "Opening the budget took too long. Open it once in Actual's own app, which makes it faster to open, then try again."
              : "Bench could not read this budget's accounts. Try again.";
        if (!output) {
          logger.warn(
            `[bank-sync-accounts] worker ${outcome.status}: ${outcome.status === "result" ? "unreadable answer" : outcome.message}`
          );
        }
        return NextResponse.json({ error: message }, { status: busy ? 503 : 502 });
      }
    } else {
      const credential = getSyncCredential(db, fingerprint);
      if (!credential) {
        return NextResponse.json({ error: "That connection has no stored credentials." }, { status: 404 });
      }
      const { secret, ...rest } = credential;
      const connection = connectionFromEnrolment(rest, secret);
      if (connection.mode !== "http-api") throw new Error("The stored credential does not match this connection.");
      accounts = await listAccountsForBankSync((body) => createHttpApiTransport(connection).runQuery(body));
    }

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

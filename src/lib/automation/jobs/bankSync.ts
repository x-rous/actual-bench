import { createHttpApiTransport } from "@/lib/actual/httpApiTransport";
import { getSyncCredential } from "@/lib/app-db/syncCredentialRepository";
import { getAppDb } from "@/lib/app-db/connection";
import { registerAutomationJobType } from "../registry";
import { BANK_SYNC_JOB_TYPE } from "./bankSyncType";
import type { AutomationJobType, AutomationRunContext } from "../registry";
import type { BankSyncAccountResult, BankSyncOutcome } from "@/lib/actual/bankSync";
import type { AutomationRunRollup, JsonEnvelope } from "@/lib/app-db/types";
import type { HttpApiConnection } from "@/store/connection";

/**
 * Automatic Bank Sync as an automation job type (RD-080 / PR-045).
 *
 * Bench asks Actual to pull from the connected banks on a schedule. It does not
 * construct the transactions and does not second-guess Actual's duplicate
 * handling — what it owns is *when* the pull happens and *what happened*.
 *
 * Two contract choices distinguish this from Budget File Sync, and they are the
 * reason the engine's registry has the shape it does:
 *
 *   * **No `classification`.** This type triggers Actual's own import path and
 *     constructs nothing, so it has nothing for the shared review queue and is
 *     absent from it rather than listed with a zero.
 *   * **A partial run does not count against health.** One unreachable bank out
 *     of twelve is a normal Tuesday; auto-pausing the whole automation over it
 *     would be wrong. Budget File Sync makes the opposite choice, because a
 *     partial *apply* there means writes failed.
 */

export type BankSyncConfig = {
  /** Vault fingerprint of the connection whose banks are pulled. */
  connectionFingerprint: string;
  /**
   * Accounts to sync. Empty means every linked account — stored as "all"
   * rather than a snapshot of ids, so an account linked later is included
   * without anyone editing the automation.
   */
  accountIds: string[];
};

export type BankSyncJobResult = BankSyncOutcome;

function readConfig(raw: JsonEnvelope): BankSyncConfig {
  const fingerprint = raw.data.connectionFingerprint;
  if (typeof fingerprint !== "string" || !fingerprint.trim()) {
    throw new Error("This automation has no connection to sync (connectionFingerprint is missing).");
  }

  const accountIds = Array.isArray(raw.data.accountIds)
    ? raw.data.accountIds.filter((value): value is string => typeof value === "string")
    : [];

  return { connectionFingerprint: fingerprint.trim(), accountIds };
}

function connectionFromVault(fingerprint: string): HttpApiConnection {
  const credential = getSyncCredential(getAppDb(), fingerprint);
  if (!credential) {
    // The engine fails closed before reaching here, so this is the narrow race
    // where the credential was withdrawn mid-run.
    throw new Error("The stored credential for this connection is no longer available.");
  }

  return {
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
}

function describe(results: BankSyncAccountResult[], countsObserved: boolean): string {
  const synced = results.filter((result) => result.status === "synced" || result.status === "accepted");
  const failed = results.filter((result) => result.status === "failed");
  const skipped = results.filter((result) => result.status === "not-linked");

  const parts: string[] = [];

  if (countsObserved) {
    const counted = synced.filter(
      (result): result is BankSyncAccountResult & { observedNewTransactions: number } =>
        typeof result.observedNewTransactions === "number"
    );
    const total = counted.reduce((sum, result) => sum + result.observedNewTransactions, 0);
    parts.push(
      total === 0
        ? `No new transactions in ${synced.length} account${synced.length === 1 ? "" : "s"}`
        : `${total} new transaction${total === 1 ? "" : "s"} in ${synced.length} account${synced.length === 1 ? "" : "s"}`
    );
  } else if (synced.length > 0) {
    // The server accepted the request without saying what arrived; claiming a
    // count here would be inventing one.
    parts.push(`Sync started for ${synced.length} account${synced.length === 1 ? "" : "s"}`);
  }

  if (failed.length > 0) parts.push(`${failed.length} failed`);
  if (skipped.length > 0) parts.push(`${skipped.length} not linked to a bank`);

  return parts.join(", ") || "Nothing to sync";
}

export const bankSyncJobType: AutomationJobType<BankSyncConfig, BankSyncJobResult> = {
  type: BANK_SYNC_JOB_TYPE,
  label: "Bank sync",

  validateConfig: readConfig,

  async run(ctx: AutomationRunContext<BankSyncConfig>): Promise<BankSyncJobResult> {
    const connection = connectionFromVault(ctx.config.connectionFingerprint);
    const transport = createHttpApiTransport(connection);

    if (!transport.runBankSync) {
      return {
        status: "unsupported",
        results: [],
        countsObserved: false,
        message: "This connection cannot trigger a bank sync.",
      };
    }

    ctx.logger.info(
      ctx.config.accountIds.length > 0
        ? `Syncing ${ctx.config.accountIds.length} selected account(s)`
        : "Syncing every account linked to a bank"
    );

    // Cancellation is honoured between accounts on both paths: the transport
    // checks the signal inside its own loop, which is the only place that knows
    // where one account ends and the next begins.
    if (ctx.config.accountIds.length > 0) {
      const results: BankSyncAccountResult[] = [];
      let countsObserved = false;

      for (const accountId of ctx.config.accountIds) {
        if (ctx.signal.aborted) break;
        const outcome = await transport.runBankSync({ accountId, signal: ctx.signal });
        results.push(...outcome.results);
        countsObserved = countsObserved || outcome.countsObserved;
      }

      return { status: rollupStatus(results), results, countsObserved };
    }

    return transport.runBankSync({ signal: ctx.signal });
  },

  summarize(result: BankSyncJobResult): AutomationRunRollup {
    const attempted = result.results.filter((entry) => entry.status !== "not-linked");
    const message = describe(result.results, result.countsObserved);

    if (result.status === "unsupported") {
      return { outcome: "failed", itemCount: 0, message: result.message ?? "Bank sync is unavailable." };
    }
    if (attempted.length === 0) {
      return { outcome: "no_changes", itemCount: 0, message: "No accounts are linked to a bank." };
    }
    if (result.status === "failed") {
      return { outcome: "failed", itemCount: attempted.length, message };
    }
    if (result.status === "partial") {
      // Deliberately not `countsAsFailure`: some banks being unreachable is an
      // ordinary outcome, and pausing the automation over it would stop the
      // accounts that do work from syncing.
      return { outcome: "partial", itemCount: attempted.length, message };
    }
    return { outcome: "ok", itemCount: attempted.length, message };
  },

  serializeResult(result: BankSyncJobResult): JsonEnvelope {
    return {
      version: 1,
      data: {
        status: result.status,
        countsObserved: result.countsObserved,
        accounts: result.results.map((entry) => ({
          accountId: entry.accountId,
          accountName: entry.accountName ?? null,
          status: entry.status,
          message: entry.message ?? null,
          observedNewTransactions: entry.observedNewTransactions ?? null,
        })),
      },
    };
  },

  // No `classification`: this type constructs nothing, so it contributes
  // nothing to the shared review queue.
};

function rollupStatus(results: BankSyncAccountResult[]): BankSyncOutcome["status"] {
  const attempted = results.filter((result) => result.status !== "not-linked");
  const failed = attempted.filter((result) => result.status === "failed");
  if (attempted.length === 0) return "ok";
  if (failed.length === 0) return "ok";
  return failed.length === attempted.length ? "failed" : "partial";
}

let registered = false;

/** Idempotent: the boot path and tests can both call it. */
export function registerBankSyncJobType(): void {
  if (registered) return;
  registerAutomationJobType(bankSyncJobType);
  registered = true;
}

/** Test-only: allow re-registration after the registry is reset. */
export function __resetBankSyncRegistrationForTests(): void {
  registered = false;
}

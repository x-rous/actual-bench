/**
 * Triggering Actual's own bank sync (RD-080 / PR-044).
 *
 * Actual can pull transactions from SimpleFIN/GoCardless, but something has to
 * start the pull. This is that trigger — Bench does not construct the
 * transactions and does not second-guess Actual's importer or its de-duplication.
 *
 * **What the underlying calls actually give us**, read from the pinned
 * `@actual-app/api` build rather than assumed:
 *
 *   * `runBankSync(args?)` resolves `void`. Internally `api/bank-sync` awaits
 *     the account sync, so in Direct mode the import really has happened by the
 *     time the promise settles.
 *   * One layer down, `accounts-bank-sync` already isolates failures per account
 *     and returns `{ errors, newTransactions, … }` — but the public API discards
 *     all of it and throws on the *first* error.
 *   * Consequently the all-accounts path cannot attribute a failure to an
 *     account. Per-account calls are therefore a requirement, not a preference.
 *   * An account with no bank link is skipped silently by Actual. It is neither
 *     synced nor failed, and must not be reported as either.
 *   * HTTP answers `200 {"message":"Bank sync started"}`. Whether that means
 *     *finished* is unverified against a live server, so this module treats it
 *     as **accepted** and never claims to know what was imported.
 */

export type BankSyncAccountStatus = "synced" | "failed" | "not-linked" | "accepted";

export type BankSyncAccountResult = {
  accountId: string;
  accountName?: string;
  status: BankSyncAccountStatus;
  /** Sanitized provider error, when the account failed. */
  message?: string;
  /**
   * New transactions Bench *observed* by reading the account before and after.
   * Null when the transport cannot tell — never a fabricated zero.
   */
  observedNewTransactions?: number | null;
};

export type BankSyncOutcome = {
  status: "ok" | "partial" | "failed" | "unsupported";
  results: BankSyncAccountResult[];
  /**
   * Whether the numbers above are real observations. False means the sync was
   * accepted but Bench cannot say what arrived, which the UI must state rather
   * than showing zeros.
   */
  countsObserved: boolean;
  /** Set when the whole operation could not run at all. */
  message?: string;
};

/** Roll up per-account results into one outcome status. */
export function summarizeBankSync(
  results: BankSyncAccountResult[],
  countsObserved: boolean
): BankSyncOutcome {
  const attempted = results.filter((result) => result.status !== "not-linked");
  const failed = attempted.filter((result) => result.status === "failed");

  if (attempted.length === 0) {
    return {
      status: "ok",
      results,
      countsObserved,
      message: "No accounts are linked to a bank.",
    };
  }
  if (failed.length === 0) return { status: "ok", results, countsObserved };
  if (failed.length === attempted.length) {
    return { status: "failed", results, countsObserved, message: failed[0].message };
  }
  return {
    status: "partial",
    results,
    countsObserved,
    message: `${failed.length} of ${attempted.length} accounts failed.`,
  };
}

/**
 * Provider errors are surfaced to the UI and to run history, and they are
 * written by servers whose text we do not author, so anything credential-shaped
 * is stripped before it travels.
 */
export function sanitizeBankSyncError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/((?:api[_-]?key|password|token|secret)["']?\s*[:=]\s*["']?)([^\s"',;}]+)/gi, "$1[redacted]")
    .replace(/(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi, "$1[redacted]")
    .replace(/(\/\/[^\s/:@]+:)([^\s@]+)(@)/g, "$1[redacted]$3")
    .slice(0, 500);
}

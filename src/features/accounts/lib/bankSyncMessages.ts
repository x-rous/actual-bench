import { BANK_SYNC_COUNT_WINDOW_DAYS } from "@/lib/actual/bankSync";
import type { BankSyncOutcome } from "@/lib/actual/bankSync";

/**
 * What to tell a person after a manual bank sync (RD-080 / PR-044).
 *
 * Separated from the component so the wording — which is where this feature is
 * most likely to overclaim — is testable on its own.
 *
 * The rule throughout: never imply Bench knows something it does not. Over HTTP
 * the sync is *accepted*, not finished, so the message says the sync was
 * started and no number is quoted. A count is only shown when it was really
 * observed.
 */

export type BankSyncMessage = {
  tone: "success" | "warning" | "error";
  text: string;
  /** Longer explanation for the accounts that did not sync. */
  detail?: string;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function bankSyncMessage(outcome: BankSyncOutcome): BankSyncMessage {
  if (outcome.status === "unsupported") {
    return { tone: "error", text: outcome.message ?? "This connection cannot trigger a bank sync." };
  }

  const attempted = outcome.results.filter((result) => result.status !== "not-linked");
  const failed = attempted.filter((result) => result.status === "failed");
  const succeeded = attempted.filter((result) => result.status !== "failed");

  if (attempted.length === 0) {
    return {
      tone: "warning",
      text: "No accounts are linked to a bank, so there was nothing to sync.",
    };
  }

  const failureDetail =
    failed.length > 0
      ? failed.map((result) => `${result.accountName ?? result.accountId}: ${result.message ?? "failed"}`).join("; ")
      : undefined;

  if (failed.length === attempted.length) {
    return {
      tone: "error",
      text: `Bank sync failed for ${plural(failed.length, "account")}.`,
      detail: failureDetail,
    };
  }

  // Counts are only quoted when the transport actually finished importing and
  // Bench measured the difference itself.
  const observed = outcome.countsObserved
    ? succeeded.reduce((total, result) => total + (result.observedNewTransactions ?? 0), 0)
    : null;

  // The window is part of the claim, not a footnote: a first sync can import
  // years of history, and a 90-day count would understate it badly.
  const succeededText = outcome.countsObserved
    ? observed === 0
      ? `No new transactions in the last ${BANK_SYNC_COUNT_WINDOW_DAYS} days in ${plural(succeeded.length, "account")}.`
      : `${plural(observed ?? 0, "new transaction")} in the last ${BANK_SYNC_COUNT_WINDOW_DAYS} days in ${plural(succeeded.length, "account")}.`
    : `Bank sync started for ${plural(succeeded.length, "account")}. Actual imports in the background, so new transactions may take a moment to appear.`;

  if (failed.length > 0) {
    return {
      tone: "warning",
      text: `${succeededText} ${plural(failed.length, "account")} failed.`,
      detail: failureDetail,
    };
  }

  return { tone: "success", text: succeededText };
}

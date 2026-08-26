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
  // Bench measured the difference itself. Accounts whose measurement failed are
  // excluded rather than counted as zero, and if none resolved there is no
  // number to quote at all.
  const measured = succeeded.filter(
    (result): result is typeof result & { observedNewTransactions: number } =>
      typeof result.observedNewTransactions === "number"
  );
  const observed =
    outcome.countsObserved && measured.length > 0
      ? measured.reduce((total, result) => total + result.observedNewTransactions, 0)
      : null;

  // The window is part of the claim, not a footnote: a first sync can import
  // years of history, and a 90-day count would understate it badly.
  // Three distinct cases, and collapsing any two of them misleads:
  //   * counted        — quote the number, with the window it was measured over
  //   * finished, uncounted — the import completed but the measurement did not
  //   * accepted       — the server took the request and has not said it finished
  const onlyAccepted = succeeded.every((result) => result.status === "accepted");

  const succeededText =
    observed !== null
      ? observed === 0
        ? `No new transactions in the last ${BANK_SYNC_COUNT_WINDOW_DAYS} days in ${plural(succeeded.length, "account")}.`
        : `${plural(observed, "new transaction")} in the last ${BANK_SYNC_COUNT_WINDOW_DAYS} days in ${plural(succeeded.length, "account")}.`
      : onlyAccepted
        ? `Bank sync started for ${plural(succeeded.length, "account")}. Actual imports in the background, so new transactions may take a moment to appear.`
        : `Bank sync finished for ${plural(succeeded.length, "account")}, but Actual Bench could not count what arrived.`;

  if (failed.length > 0) {
    return {
      tone: "warning",
      text: `${succeededText} ${plural(failed.length, "account")} failed.`,
      detail: failureDetail,
    };
  }

  return { tone: "success", text: succeededText };
}
